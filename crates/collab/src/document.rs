use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

/// Tracks connected clients and the document state for a single page.
pub struct Document {
    /// The page ID this document belongs to.
    pub page_id: Uuid,
    /// Binary blob of the Y.js document state (raw).
    /// We store the opaque binary so the CRDT merge logic can be refined later.
    pub state: Vec<u8>,
    /// Set of connected client IDs (for broadcast tracking).
    pub connected_clients: HashSet<String>,
    /// Whether the document has unsaved changes.
    pub dirty: bool,
    /// Broadcast channel: sends (sender_client_id, update_data) to all subscribers.
    pub tx: broadcast::Sender<(String, Vec<u8>)>,
}

impl Document {
    /// Create a new document from stored binary state.
    pub fn new(page_id: Uuid, state: Vec<u8>) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            page_id,
            state,
            connected_clients: HashSet::new(),
            dirty: false,
            tx,
        }
    }

    /// Create an empty document.
    pub fn empty(page_id: Uuid) -> Self {
        Self::new(page_id, Vec::new())
    }

    /// Subscribe to the broadcast channel for this document.
    /// Returns a receiver that yields (sender_client_id, update_data) tuples.
    pub fn subscribe(&self) -> broadcast::Receiver<(String, Vec<u8>)> {
        self.tx.subscribe()
    }

    /// Apply an update to the document state.
    /// For now, this simply stores the latest full-state blob.
    /// Full CRDT merge logic (using yrs) can be layered on later.
    pub fn apply_update(&mut self, data: &[u8]) {
        // Append the update or replace state -- simplified approach.
        // In a full implementation, this would merge using yrs.
        if !data.is_empty() {
            self.state = data.to_vec();
            self.dirty = true;
        }
    }

    /// Add a connected client.
    pub fn add_client(&mut self, client_id: String) -> bool {
        self.connected_clients.insert(client_id)
    }

    /// Remove a connected client.
    pub fn remove_client(&mut self, client_id: &str) -> bool {
        self.connected_clients.remove(client_id)
    }

    /// Number of connected clients.
    pub fn client_count(&self) -> usize {
        self.connected_clients.len()
    }
}

/// Registry of in-memory documents, keyed by page_id.
pub struct DocumentRegistry {
    docs: RwLock<std::collections::HashMap<Uuid, Arc<RwLock<Document>>>>,
}

impl DocumentRegistry {
    pub fn new() -> Self {
        Self {
            docs: RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// Get or create a document handle for the given page.
    pub async fn get_or_create(
        &self,
        page_id: Uuid,
        initial_state: Vec<u8>,
    ) -> Arc<RwLock<Document>> {
        let mut docs = self.docs.write().await;
        docs.entry(page_id)
            .or_insert_with(|| {
                Arc::new(RwLock::new(Document::new(page_id, initial_state)))
            })
            .clone()
    }

    /// Remove a document from the registry (e.g., after all clients disconnect).
    pub async fn remove(&self, page_id: Uuid) {
        let mut docs = self.docs.write().await;
        docs.remove(&page_id);
    }

    /// Check if a document is loaded.
    pub async fn contains(&self, page_id: Uuid) -> bool {
        self.docs.read().await.contains_key(&page_id)
    }
}

impl Default for DocumentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    // ── Broadcast tests ──────────────────────────────────────────────

    #[tokio::test]
    async fn broadcast_delivers_to_all_subscribers() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        // Subscribe both "clients" before anyone sends.
        let mut rx1 = doc.read().await.subscribe();
        let mut rx2 = doc.read().await.subscribe();

        // Client-1 broadcasts an update.
        let update_data = vec![1, 2, 3, 4, 5];
        doc.read()
            .await
            .tx
            .send(("client-1".into(), update_data.clone()))
            .unwrap();

        // Client-1 receives it.
        let (sender1, data1) = rx1.try_recv().unwrap();
        assert_eq!(sender1, "client-1");
        assert_eq!(data1, update_data);

        // Client-2 also receives it.
        let (sender2, data2) = rx2.try_recv().unwrap();
        assert_eq!(sender2, "client-1");
        assert_eq!(data2, update_data);
    }

    #[tokio::test]
    async fn broadcast_receiver_can_identify_sender() {
        // In the real handler, each client skips messages where sender == self.
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        let mut rx = doc.read().await.subscribe();
        let my_client_id = "my-client".to_string();

        doc.read()
            .await
            .tx
            .send((my_client_id.clone(), vec![1, 2, 3]))
            .unwrap();

        let (sender, _) = rx.try_recv().unwrap();
        // The receiver can filter: if sender == listener_client_id, skip.
        assert_eq!(sender, my_client_id);
    }

    #[tokio::test]
    async fn broadcast_late_subscriber_misses_earlier_messages() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        // Hold one receiver so the channel accepts the send.
        let mut rx_early = doc.read().await.subscribe();

        // Send a message.
        doc.read().await.tx.send(("early".into(), vec![42])).unwrap();

        // Early subscriber sees it.
        let (sender, data) = rx_early.try_recv().unwrap();
        assert_eq!(sender, "early");
        assert_eq!(data, vec![42]);

        // Late subscriber (subscribed after the send) misses it.
        let mut rx_late = doc.read().await.subscribe();
        assert!(rx_late.try_recv().is_err());
    }

    // ── Document state tests ─────────────────────────────────────────

    #[tokio::test]
    async fn apply_update_stores_state_and_marks_dirty() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        {
            let mut d = doc.write().await;
            d.apply_update(&[10, 20, 30]);
            assert!(d.dirty, "document should be dirty after update");
            assert_eq!(d.state, vec![10, 20, 30]);
        }

        // State persists after releasing the write lock.
        {
            let d = doc.read().await;
            assert_eq!(d.state, vec![10, 20, 30]);
        }
    }

    #[tokio::test]
    async fn apply_update_with_empty_data_is_noop() {
        let page_id = Uuid::new_v4();
        let mut doc = Document::new(page_id, vec![99]);

        doc.apply_update(&[]);
        assert!(!doc.dirty, "empty update should not mark dirty");
        assert_eq!(doc.state, vec![99], "state should be unchanged");
    }

    // ── Client tracking tests ────────────────────────────────────────

    #[tokio::test]
    async fn client_tracking_add_remove_count() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        {
            let mut d = doc.write().await;
            assert!(d.add_client("c1".into()));
            assert!(d.add_client("c2".into()));
            assert!(!d.add_client("c1".into()), "duplicate add returns false");
            assert_eq!(d.client_count(), 2);
        }

        {
            let mut d = doc.write().await;
            assert!(d.remove_client("c1"));
            assert!(!d.remove_client("c1"), "second remove returns false");
            assert_eq!(d.client_count(), 1);
        }
    }

    // ── Registry tests ───────────────────────────────────────────────

    #[tokio::test]
    async fn registry_get_or_create_is_idempotent() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();

        let doc1 = registry.get_or_create(page_id, vec![1, 2, 3]).await;
        let doc2 = registry.get_or_create(page_id, vec![9, 9, 9]).await;

        // Must be the same Arc (pointer equality).
        assert!(Arc::ptr_eq(&doc1, &doc2));

        // Initial state from the first call wins.
        assert_eq!(doc1.read().await.state, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn registry_remove_drops_document() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();

        registry.get_or_create(page_id, vec![]).await;
        assert!(registry.contains(page_id).await);

        registry.remove(page_id).await;
        assert!(!registry.contains(page_id).await);
    }

    #[tokio::test]
    async fn registry_default_trait() {
        let reg = DocumentRegistry::default();
        let id = Uuid::new_v4();
        reg.get_or_create(id, vec![]).await;
        assert!(reg.contains(id).await);
    }

    // ── Concurrency stress test ──────────────────────────────────────

    #[tokio::test]
    async fn concurrent_broadcasts_deliver_in_order() {
        let registry = DocumentRegistry::new();
        let page_id = Uuid::new_v4();
        let doc = registry.get_or_create(page_id, vec![]).await;

        let mut rx = doc.read().await.subscribe();

        // Send several messages in quick succession.
        for i in 0u8..10 {
            doc.read()
                .await
                .tx
                .send(("sender".into(), vec![i]))
                .unwrap();
        }

        // Receiver should see all 10 in order.
        for i in 0u8..10 {
            let (_, data) = timeout(Duration::from_millis(500), async {
                loop {
                    match rx.try_recv() {
                        Ok(msg) => break msg,
                        Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                            tokio::task::yield_now().await;
                        }
                        Err(e) => panic!("unexpected recv error: {e}"),
                    }
                }
            })
            .await
            .expect("timed out waiting for message");
            assert_eq!(data, vec![i]);
        }
    }
}
