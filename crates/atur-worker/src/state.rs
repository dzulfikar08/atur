use worker::Env;

#[derive(Clone)]
pub struct AppState {
    pub env: Env,
}
