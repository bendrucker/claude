#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p scripts importer/src data
cat > scripts/import.rb <<'RB'
#!/usr/bin/env ruby
# Normalize a vendor CSV into tab-separated rows for the loader.
require "csv"
CSV.foreach(ARGV.fetch(0), headers: true) do |row|
  next if row["sku"].to_s.strip.empty?
  puts [row["sku"].strip.upcase, format("%.2f", row["price"].to_f), row["name"].to_s.squeeze(" ")].join("\t")
end
RB
chmod +x scripts/import.rb
cat > importer/Cargo.toml <<'TOML'
[package]
name = "importer"
version = "0.1.0"
edition = "2021"

[dependencies]
csv = "1"
TOML
cat > importer/src/main.rs <<'RS'
use std::env;

fn main() {
    let path = env::args().nth(1).expect("path");
    let mut reader = csv::Reader::from_path(path).expect("open");
    for row in reader.records() {
        let row = row.expect("row");
        let sku = row.get(0).unwrap_or("").trim();
        if sku.is_empty() { continue; }
        let price: f64 = row.get(1).unwrap_or("0").parse().unwrap_or(0.0);
        println!("{}\t{:.2}\t{}", sku.to_uppercase(), price, row.get(2).unwrap_or(""));
    }
}
RS
printf 'sku,price,name\nab-1,3.5,Blue  Mug\n,2,Missing\nzz-9,10,Plain\n' > data/sample.csv
git add -A && git commit -qm "Add Rust importer"
