use base64::Engine;
use sha2::{Digest, Sha256};

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).expect("getrandom: crypto.getRandomValues failed");
    buf
}

pub fn generate_token() -> String {
    let bytes = random_bytes(32);
    base64::engine::general_purpose::STANDARD_NO_PAD.encode(&bytes)
}

pub fn hash_password(password: &str) -> String {
    let salt = random_bytes(16);
    let salt_hex = hex::encode(&salt);
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(&salt);
    let hash = hex::encode(hasher.finalize());
    format!("{}:{}", hash, salt_hex)
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 2 {
        return false;
    }
    let stored_hash = parts[0];
    let salt_hex = parts[1];
    let salt = match hex::decode(salt_hex) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(&salt);
    let computed_hash = hex::encode(hasher.finalize());
    constant_time_eq(computed_hash.as_bytes(), stored_hash.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn generate_uuid_v4() -> String {
    let bytes = random_bytes(16);
    let mut uuid_bytes: [u8; 16] = [0; 16];
    uuid_bytes.copy_from_slice(&bytes[..16]);
    uuid_bytes[6] = (uuid_bytes[6] & 0x0f) | 0x40;
    uuid_bytes[8] = (uuid_bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        uuid_bytes[0], uuid_bytes[1], uuid_bytes[2], uuid_bytes[3],
        uuid_bytes[4], uuid_bytes[5],
        uuid_bytes[6], uuid_bytes[7],
        uuid_bytes[8], uuid_bytes[9],
        uuid_bytes[10], uuid_bytes[11], uuid_bytes[12], uuid_bytes[13], uuid_bytes[14], uuid_bytes[15],
    )
}
