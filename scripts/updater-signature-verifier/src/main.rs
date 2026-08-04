use std::{env, fs, path::Path};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use minisign_verify::{PublicKey, Signature};

fn decode_text(value: &str, label: &str) -> Result<String, String> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|_| format!("{label} is not valid base64"))?;
    String::from_utf8(bytes).map_err(|_| format!("{label} is not valid UTF-8"))
}

fn verify(artifact: &Path, signature_path: &Path, encoded_key: &str) -> Result<(), String> {
    let public_key = PublicKey::decode(&decode_text(encoded_key, "updater public key")?)
        .map_err(|error| format!("updater public key is invalid: {error}"))?;
    let encoded_signature = fs::read_to_string(signature_path)
        .map_err(|error| format!("could not read updater signature: {error}"))?;
    let signature = Signature::decode(&decode_text(&encoded_signature, "updater signature")?)
        .map_err(|error| format!("updater signature is invalid: {error}"))?;
    let bytes =
        fs::read(artifact).map_err(|error| format!("could not read updater artifact: {error}"))?;
    public_key
        .verify(&bytes, &signature, true)
        .map_err(|error| format!("updater signature did not verify: {error}"))
}

fn main() {
    let mut arguments = env::args_os().skip(1);
    let artifact = arguments.next();
    let signature = arguments.next();
    if artifact.is_none() || signature.is_none() || arguments.next().is_some() {
        eprintln!("usage: dusori-updater-signature-verifier <artifact> <signature>");
        std::process::exit(2);
    }
    let key = env::var("DUSORI_UPDATER_PUBLIC_KEY").unwrap_or_default();
    if key.len() < 32 || key.contains("NOT_PROVISIONED") {
        eprintln!("DUSORI_UPDATER_PUBLIC_KEY is missing or invalid");
        std::process::exit(2);
    }
    if let Err(error) = verify(
        Path::new(&artifact.unwrap()),
        Path::new(&signature.unwrap()),
        &key,
    ) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("Updater signature verified.");
}
