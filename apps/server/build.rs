use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::Path,
};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let fingerprint = track("ui");
    println!("cargo:rustc-env=WEBPTY_UI_FINGERPRINT={fingerprint:016x}");
}

fn track(path: &str) -> u64 {
    println!("cargo:rerun-if-changed={path}");
    let mut hasher = DefaultHasher::new();
    visit(Path::new(path), &mut hasher);
    hasher.finish()
}

fn visit(path: &Path, hasher: &mut DefaultHasher) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };

    if metadata.is_file() {
        hash_file(path, hasher);
        return;
    }

    path.display().to_string().hash(hasher);

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let child = entry.path();
        println!("cargo:rerun-if-changed={}", child.display());

        if child.is_dir() {
            visit(&child, hasher);
        } else {
            hash_file(&child, hasher);
        }
    }
}

fn hash_file(path: &Path, hasher: &mut DefaultHasher) {
    path.display().to_string().hash(hasher);

    let Ok(mut file) = fs::File::open(path) else {
        return;
    };

    let mut buffer = Vec::new();
    if file.read_to_end(&mut buffer).is_ok() {
        buffer.hash(hasher);
    }
}
