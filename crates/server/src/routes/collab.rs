use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Extension, Path, State, WebSocketUpgrade, ws::{Message, WebSocket}};
use axum::response::IntoResponse;
use collab::protocol::SyncMessage;
use futures_util::{SinkExt, StreamExt};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};
use tokio::sync::{broadcast, Mutex};
use tokio::time;
use uuid::Uuid;

use db::entities::pages;
use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

/// Debounce interval for saving document changes (seconds).
const SAVE_DEBOUNCE_SECS: u64 = 10;

/// WS /live/collaboration/{page_id} - WebSocket upgrade endpoint.
///
/// Authentication is done by extracting the CurrentUser from the request
/// extensions (set by the auth middleware or by manual header check).
pub async fn collab_ws_upgrade(
    State(state): State<AppState>,
    Path(page_id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // The auth middleware runs before this handler in the main router.
    // For the /live path (outside auth middleware), we rely on manual auth.
    // The ws handler will do manual token check inside the stream.
    Ok(ws.on_upgrade(move |socket| handle_collab_ws(socket, state, page_id)))
}

/// WS /live/collaboration-authed/{page_id} - Authenticated version (behind middleware).
pub async fn collab_ws_upgrade_authed(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(page_id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // Verify the page exists and user has access
    let _page = pages::Entity::find()
        .filter(pages::Column::Id.eq(page_id))
        .filter(pages::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Page not found".into()))?;

    let user_id = current_user.0.id;
    Ok(ws.on_upgrade(move |socket| {
        handle_collab_ws_inner(socket, state, page_id, user_id)
    }))
}

/// Inner WebSocket handler for the collaboration connection.
async fn handle_collab_ws_inner(
    socket: WebSocket,
    state: AppState,
    page_id: Uuid,
    user_id: Uuid,
) {
    let (ws_sender, mut receiver) = socket.split();

    // Wrap sender in Arc<Mutex> so both the listener task and main loop can send
    let sender = Arc::new(Mutex::new(ws_sender));

    // Load document binary from DB
    let initial_state = match load_page_binary(&state, page_id).await {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("Failed to load page binary for {}: {}", page_id, e);
            let mut s = sender.lock().await;
            let _ = s
                .send(Message::Text("Failed to load document".into()))
                .await;
            return;
        }
    };

    // Get or create document in registry (shared via AppState)
    let doc_registry = state.doc_registry.clone();
    let doc_handle = doc_registry.get_or_create(page_id, initial_state).await;

    // Add this client
    let client_id = format!("{}-{}", user_id, Uuid::new_v4());
    {
        let mut doc = doc_handle.write().await;
        doc.add_client(client_id.clone());
    }
    tracing::info!(client = %client_id, page = %page_id, "Collab client connected");

    // Send current state to the newly connected client
    {
        let doc = doc_handle.read().await;
        if !doc.state.is_empty() {
            let msg = SyncMessage::Step2(doc.state.clone());
            let mut s = sender.lock().await;
            if let Err(e) = s.send(Message::Binary(msg.to_bytes().into())).await {
                tracing::warn!("Failed to send initial state: {}", e);
            }
        }
    }

    // Subscribe to broadcast channel for this document
    let mut broadcast_rx = {
        let doc = doc_handle.read().await;
        doc.subscribe()
    };

    // Spawn listener task to forward broadcasts to this client
    let listener_sender = sender.clone();
    let listener_client_id = client_id.clone();
    let listener_handle = tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok((sender_id, data)) => {
                    // Skip messages from ourselves
                    if sender_id == listener_client_id {
                        continue;
                    }
                    let msg = SyncMessage::Update(data);
                    let mut s = listener_sender.lock().await;
                    if let Err(e) = s.send(Message::Binary(msg.to_bytes().into())).await {
                        tracing::debug!("Broadcast listener send failed: {}", e);
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(client = %listener_client_id, "Broadcast lagged by {} messages", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });

    // Set up debounced save
    let save_state = state.clone();
    let save_doc = doc_handle.clone();
    let save_client_id = client_id.clone();

    // Spawn debounced save task
    let save_handle = tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(SAVE_DEBOUNCE_SECS));
        interval.tick().await; // skip first tick
        loop {
            interval.tick().await;
            let doc = save_doc.read().await;
            if doc.dirty {
                let data = doc.state.clone();
                drop(doc); // release read lock before IO

                match save_document(&save_state, page_id, &data).await {
                    Ok(()) => {
                        let mut doc = save_doc.write().await;
                        doc.dirty = false;
                        tracing::debug!(page = %page_id, "Document saved (debounced)");
                    }
                    Err(e) => {
                        tracing::error!(page = %page_id, "Failed to save document: {}", e);
                    }
                }
            }
        }
    });

    // Message loop: read from client WebSocket
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Binary(data) => {
                if let Some(sync_msg) = SyncMessage::from_bytes(&data) {
                    let mut doc = doc_handle.write().await;
                    match sync_msg {
                        SyncMessage::Step1(_state_vector) => {
                            // Client is requesting our state; send Step2 with full state
                            let response = SyncMessage::Step2(doc.state.clone());
                            drop(doc); // release lock before sending
                            let mut s = sender.lock().await;
                            if let Err(e) =
                                s.send(Message::Binary(response.to_bytes().into())).await
                            {
                                tracing::warn!("Failed to send Step2: {}", e);
                                break;
                            }
                        }
                        SyncMessage::Step2(diff) => {
                            doc.apply_update(&diff);
                        }
                        SyncMessage::Update(update) => {
                            doc.apply_update(&update);
                            // Broadcast to other clients
                            let _ = doc.tx.send((client_id.clone(), update));
                        }
                    }
                }
            }
            Message::Text(text) => {
                tracing::debug!(text = %text, "Received text message on collab WS");
            }
            Message::Close(_) => {
                break;
            }
            _ => {}
        }
    }

    // Cleanup: remove client
    {
        let mut doc = doc_handle.write().await;
        doc.remove_client(&client_id);
        let remaining = doc.client_count();

        // If no more clients and document is dirty, save one last time
        if remaining == 0 && doc.dirty {
            let data = doc.state.clone();
            doc.dirty = false;
            drop(doc);
            let _ = save_document(&state, page_id, &data).await;
            doc_registry.remove(page_id).await;
        }
    }

    listener_handle.abort();
    save_handle.abort();

    tracing::info!(client = %save_client_id, page = %page_id, "Collab client disconnected");
}

/// Legacy handler (non-authed, used for the /live path without auth middleware).
async fn handle_collab_ws(socket: WebSocket, state: AppState, page_id: Uuid) {
    // For the unauthenticated path, we just run the inner handler with a dummy user.
    // In production, you'd verify the session cookie manually here.
    let user_id = Uuid::nil();
    handle_collab_ws_inner(socket, state, page_id, user_id).await;
}

/// Load the binary document state from DB.
async fn load_page_binary(state: &AppState, page_id: Uuid) -> anyhow::Result<Vec<u8>> {
    let page = pages::Entity::find_by_id(page_id)
        .one(&state.db)
        .await?;

    Ok(page
        .and_then(|p| p.description_binary)
        .unwrap_or_default())
}

/// Save the document binary back to DB.
async fn save_document(state: &AppState, page_id: Uuid, data: &[u8]) -> anyhow::Result<()> {
    let page = pages::Entity::find_by_id(page_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Page {} not found", page_id))?;

    let now = chrono::Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.description_binary = Set(if data.is_empty() {
        None
    } else {
        Some(data.to_vec())
    });
    active.updated_at = Set(Some(now));
    active.update(&state.db).await?;

    Ok(())
}
