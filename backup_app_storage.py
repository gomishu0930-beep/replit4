from pathlib import Path
from replit.object_storage import Client

client = Client()

BASE_DIR = Path("app-storage-backup")
BASE_DIR.mkdir(parents=True, exist_ok=True)

objects = client.list()

count = 0
failed = []

for obj in objects:
    name = obj.name
    path = BASE_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        client.download_to_filename(name, str(path))
        count += 1
        print(f"OK: {name}")
    except Exception as e:
        failed.append((name, str(e)))
        print(f"ERROR: {name} | {e}")

print(f"\n完了: {count}件")

if failed:
    print("\n失敗一覧:")
    for name, err in failed:
        print(f"- {name}: {err}")
        