//! Local Argon2id PIN & Master Password Key Derivation Module.
//! Hashes and verifies user PINs using the `argon2` crate with OS CSPRNG salts (`OsRng`).

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;

/// Derives an Argon2id PHC hash string from a plaintext PIN or Master Password (min 4 chars)
/// using a 128-bit cryptographic random salt from the OS RNG (`OsRng`).
pub fn hash_pin_argon2id(pin: &str) -> Result<String, String> {
    let trimmed = pin.trim();
    if trimmed.len() < 4 {
        return Err("PIN or password must be at least 4 characters.".to_string());
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(trimmed.as_bytes(), &salt)
        .map_err(|e| format!("Failed to hash PIN: {}", e))?
        .to_string();
    Ok(hash)
}

/// Verifies a plaintext PIN or Master Password against a stored Argon2id PHC string.
pub fn verify_pin_argon2id(pin: &str, encoded_hash: &str) -> Result<bool, String> {
    let parsed_hash =
        PasswordHash::new(encoded_hash).map_err(|e| format!("Invalid stored PIN hash: {}", e))?;
    Ok(Argon2::default()
        .verify_password(pin.trim().as_bytes(), &parsed_hash)
        .is_ok())
}
