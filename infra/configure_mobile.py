import hashlib
import json
import os
import pathlib
import plistlib
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

root = pathlib.Path.cwd()
bundle = os.environ['BUNDLE_ID']
name = os.environ['APP_NAME']
if not re.fullmatch(r'[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}', bundle):
    raise ValueError('Invalid Bundle ID')
job = json.loads(pathlib.Path(os.environ['JOB_FILE']).read_text())
manifest = root / 'android/app/src/main/AndroidManifest.xml'
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ns)
tree = ET.parse(manifest)
application = tree.getroot().find('application')
application.set(f'{{{ns}}}label', name)
permissions = ['INTERNET','CAMERA','RECORD_AUDIO','ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION',
               'ACCESS_BACKGROUND_LOCATION','FOREGROUND_SERVICE','FOREGROUND_SERVICE_LOCATION','POST_NOTIFICATIONS','NFC']
existing = {node.get(f'{{{ns}}}name') for node in tree.getroot().findall('uses-permission')}
for permission in permissions:
    value = 'android.permission.' + permission
    if value not in existing:
        ET.SubElement(tree.getroot(), 'uses-permission', {f'{{{ns}}}name': value})
tree.write(manifest, encoding='utf-8', xml_declaration=True)
gradle = root / 'android/app/build.gradle.kts'
text = gradle.read_text()
original = re.search(r'namespace\s*=\s*"([^"]+)"', text).group(1)
text = text.replace(original, bundle)
text = re.sub(r'minSdk\s*=\s*[^\n]+', 'minSdk = 24', text)
text = text.replace('defaultConfig {', 'defaultConfig {\n        manifestPlaceholders["appAuthRedirectScheme"] = "' + bundle + '"')
text = text.replace('buildTypes {', '''signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {''')
text = text.replace('signingConfig = signingConfigs.getByName("debug")', 'signingConfig = signingConfigs.getByName("release")')
gradle.write_text(text)
for kotlin in (root / 'android/app/src/main').rglob('*.kt'):
    kotlin.write_text(kotlin.read_text().replace(original, bundle))
project = root / 'ios/Runner.xcodeproj/project.pbxproj'
text = project.read_text()
text = re.sub(r'PRODUCT_BUNDLE_IDENTIFIER = [^;]+;', 'PRODUCT_BUNDLE_IDENTIFIER = ' + bundle + ';', text)
text = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [^;]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 14.0;', text)
project.write_text(text)
podfile = root / 'ios/Podfile'
if podfile.exists():
    podfile.write_text(re.sub(r"#?\s*platform :ios, '[^']+'", "platform :ios, '14.0'", podfile.read_text()))
info_path = root / 'ios/Runner/Info.plist'
with info_path.open('rb') as f:
    info = plistlib.load(f)
info.update({'CFBundleDisplayName':name,'CFBundleName':name,
             'NSCameraUsageDescription':'Capturar evidencia cuando lo solicites.',
             'NSMicrophoneUsageDescription':'Grabar notas de voz cuando lo solicites.',
             'NSLocationWhenInUseUsageDescription':'Registrar la ubicación de tus capturas y recorridos.',
             'NSLocationAlwaysAndWhenInUseUsageDescription':'Continuar el recorrido autorizado en segundo plano.',
             'NSPhotoLibraryUsageDescription':'Seleccionar archivos para los formularios.',
             'NFCReaderUsageDescription':'Leer etiquetas de equipos.',
             'UIBackgroundModes':['location'],
             'CFBundleURLTypes':[{'CFBundleURLSchemes':[bundle]}]})
with info_path.open('wb') as f:
    plistlib.dump(info, f)
entitlements = root / 'ios/Runner/Runner.entitlements'
with entitlements.open('wb') as f:
    plistlib.dump({'com.apple.developer.nfc.readersession.formats':['TAG','NDEF']},f)
text = project.read_text().replace('INFOPLIST_FILE = Runner/Info.plist;', 'INFOPLIST_FILE = Runner/Info.plist; CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;')
project.write_text(text)
if job.get('assetsUrl'):
    url = urllib.parse.urlparse(job['assetsUrl'])
    if url.scheme != 'https' or url.hostname not in os.environ.get('ASSET_HOSTS','').split(','):
        raise ValueError('Unapproved asset host')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise ValueError('Asset redirects forbidden')
    with urllib.request.build_opener(NoRedirect).open(job['assetsUrl'],timeout=30) as response:
        data=response.read(10_000_001)
    if len(data)>10_000_000 or hashlib.sha256(data).hexdigest()!=job['assetsSha256']:
        raise ValueError('Invalid asset size or checksum')
    (root/'assets/brand.png').write_bytes(data)
