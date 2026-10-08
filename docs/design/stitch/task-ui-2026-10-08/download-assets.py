"""Download the existing Stitch exports; does not generate or modify designs."""
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {"contribution.usercontent.google.com", "lh3.googleusercontent.com"}


def main():
    manifest = json.loads((ROOT / "screens.json").read_text())
    failures = []
    for screen in manifest["screens"]:
        category = screen["category"]
        if not category.isascii() or not category.isalpha():
            raise ValueError("Invalid category filename")
        for key, suffix in [("htmlUrl", "html"), ("screenshotUrl", "png")]:
            url = screen[key]
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
                raise ValueError("Unexpected export destination")
            destination = ROOT / f"{category}.{suffix}"
            if destination.exists():
                print(f"Already downloaded: {destination.name}")
                continue
            try:
                with urlopen(url, timeout=30) as response:
                    data = response.read()
                if suffix == "png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Export is not a PNG image")
                if suffix == "html" and b"<html" not in data.lower():
                    raise ValueError("Export is not an HTML document")
                destination.write_bytes(data)
                print(f"Downloaded {destination.name}: {len(data)} bytes")
            except Exception as error:
                failures.append(destination.name)
                print(f"Unavailable {destination.name}: {type(error).__name__}")
    if failures:
        raise SystemExit("Export download incomplete; check applied network rules and the current Stitch export URLs.")


if __name__ == "__main__":
    main()
