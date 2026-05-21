/// Y.js sync protocol message types for WebSocket binary frames.
///
/// Wire format:
///   0x00 = SyncStep1  (client sends state vector)
///   0x01 = SyncStep2  (server sends diff)
///   0x02 = Update     (incremental update)

/// Protocol message types for the Y.js sync protocol.
#[derive(Debug, Clone)]
pub enum SyncMessage {
    /// Client sends its current state vector.
    Step1(Vec<u8>),
    /// Server (or peer) sends a diff based on the state vector.
    Step2(Vec<u8>),
    /// An incremental update to apply.
    Update(Vec<u8>),
}

impl SyncMessage {
    /// Parse a binary WebSocket frame into a SyncMessage.
    ///
    /// Expected wire format: first byte is the message type tag,
    /// remaining bytes are the payload.
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.is_empty() {
            return None;
        }
        match data[0] {
            0x00 => Some(SyncMessage::Step1(data[1..].to_vec())),
            0x01 => Some(SyncMessage::Step2(data[1..].to_vec())),
            0x02 => Some(SyncMessage::Update(data[1..].to_vec())),
            _ => None,
        }
    }

    /// Serialize a SyncMessage into bytes for sending over WebSocket.
    pub fn to_bytes(&self) -> Vec<u8> {
        let (tag, payload) = match self {
            SyncMessage::Step1(p) => (0x00u8, p),
            SyncMessage::Step2(p) => (0x01u8, p),
            SyncMessage::Update(p) => (0x02u8, p),
        };
        let mut buf = Vec::with_capacity(1 + payload.len());
        buf.push(tag);
        buf.extend_from_slice(payload);
        buf
    }
}
