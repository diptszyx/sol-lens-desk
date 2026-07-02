use std::fs;

fn main() {
    // Bake HELIUS_API_KEY into the binary so a distributed build works without a
    // runtime .env on the tester's machine. Priority: build-time env var, then
    // ../.env (dev), then ./.env. Missing/empty is fine — at runtime the app
    // falls back to a public RPC and any key set in Settings, and dev builds can
    // still override via a runtime .env (dotenvy).
    if let Some(key) = resolve_helius_key() {
        println!("cargo:rustc-env=HELIUS_API_KEY={key}");
    }
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed=HELIUS_API_KEY");

    tauri_build::build()
}

fn resolve_helius_key() -> Option<String> {
    if let Ok(k) = std::env::var("HELIUS_API_KEY") {
        if !k.is_empty() {
            return Some(k);
        }
    }
    for path in ["../.env", ".env"] {
        let Ok(contents) = fs::read_to_string(path) else { continue };
        for line in contents.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("HELIUS_API_KEY=") {
                let v = rest.trim().trim_matches('"').trim_matches('\'');
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}
