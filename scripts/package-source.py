from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import os

project = Path(__file__).resolve().parent.parent
target = project.parent / 'SuperApp-Engine.zip'
excluded = {'.vercel', 'node_modules', '.tooling', '.npm-cache', '.git', 'dist', '__pycache__', '.dart_tool', 'build', 'artifacts', 'data', 'native-web', '.gradle', 'Pods'}
files = []
for directory, subdirs, names in os.walk(project):
    subdirs[:] = [name for name in subdirs if name not in excluded]
    for name in names:
        path = Path(directory) / name
        relative = path.relative_to(project)
        if name.startswith('.env') or name.startswith('.flutter-plugins') or name.startswith('flutter_'):
            continue
        if relative.parts[:2] in [('mobile','android'),('mobile','ios')]:
            continue
        files.append(path)
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files):
        name = (Path('superapp-engine') / path.relative_to(project)).as_posix()
        if path.suffix == '.sh':
            info = ZipInfo.from_file(path, arcname=name)
            info.create_system = 3
            info.external_attr = 0o100755 << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
        else:
            archive.write(path, name)
with ZipFile(target) as archive:
    assert archive.testzip() is None
print(f'{target.name}: {len(files)} files, {target.stat().st_size} bytes')
print('SHA-256: ' + hashlib.sha256(target.read_bytes()).hexdigest())
