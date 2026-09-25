import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:image_picker/image_picker.dart';
import 'package:native_exif/native_exif.dart';
import 'package:record/record.dart';
import 'package:location/location.dart';
import 'package:flutter_nfc_kit/flutter_nfc_kit.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';
import 'api_client.dart';

typedef HardwareHandler = Future<Map<String, dynamic>> Function(
    Map<String, dynamic> config);

class HardwareBridge {
  HardwareBridge._();
  static final instance = HardwareBridge._();
  final _location = Location();
  final _audio = AudioRecorder();
  final _handlers = <String, HardwareHandler>{};
  final amplitude = StreamController<double>.broadcast();
  StreamSubscription<Amplitude>? _amplitudeSubscription;
  StreamSubscription<LocationData>? _locationSubscription;
  Timer? _audioTimer;
  Timer? _syncTimer;
  Database? _db;
  ApiClient? _api;
  String? _scope;
  String? _audioPath;
  io.Socket? _socket;
  MqttServerClient? _mqtt;
  final _inside = <String, bool>{};
  bool _syncing = false;
  void register(String kind, HardwareHandler handler) =>
      _handlers[kind] = handler;
  Future<void> initialize(ApiClient api) async {
    await stopTracking();
    await _db?.close();
    _api = api;
    _scope = api.namespace;
    if (_scope == null)
      throw StateError('Inicia sesión antes de abrir el almacenamiento');
    final filename = sha256.convert(utf8.encode(_scope!)).toString();
    _db = await openDatabase(
        p.join(await getDatabasesPath(), 'superapp_$filename.db'),
        version: 1, onCreate: (db, version) async {
      await db.execute(
          'CREATE TABLE queue (id TEXT PRIMARY KEY, route TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT "pending")');
      await db.execute(
          'CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT)');
    });
    register('camera', capture);
    register('nfc', readNfc);
    register('gis', (config) async {
      await startTracking(config);
      return {'tracking': true};
    });
    _syncTimer?.cancel();
    _syncTimer =
        Timer.periodic(const Duration(seconds: 20), (_) => unawaited(flush()));
  }

  Future<Map<String, dynamic>> execute(Map<String, dynamic> config) async {
    final handler = _handlers[config['kind']];
    if (handler == null) throw UnsupportedError('Hardware no registrado');
    return handler(config);
  }

  Future<LocationData> position() async {
    if (!await _location.serviceEnabled() && !await _location.requestService())
      throw StateError('Activa la ubicación');
    var permission = await _location.hasPermission();
    if (permission == PermissionStatus.denied)
      permission = await _location.requestPermission();
    if (permission != PermissionStatus.granted &&
        permission != PermissionStatus.grantedLimited)
      throw StateError('Permiso de ubicación denegado');
    return _location.getLocation();
  }

  Future<Map<String, dynamic>> capture(Map<String, dynamic> config) async {
    final picker = ImagePicker();
    final file = config['mode'] == 'video'
        ? await picker.pickVideo(
            source: ImageSource.camera, maxDuration: const Duration(minutes: 5))
        : await picker.pickImage(
            source: ImageSource.camera,
            maxWidth: 1920,
            maxHeight: 1920,
            imageQuality: 95);
    if (file == null) throw StateError('Captura cancelada');
    final dir = await getApplicationDocumentsDirectory();
    final target = await File(file.path).copy(
        p.join(dir.path, '${const Uuid().v4()}${p.extension(file.path)}'));
    final now = DateTime.now().toUtc().toIso8601String();
    final metadata = <String, dynamic>{
      'path': target.path,
      'timestamp': now,
      'mime': config['mode'] == 'video' ? 'video/mp4' : 'image/jpeg'
    };
    if (config['gps'] == true) {
      final point = await position();
      metadata['latitude'] = point.latitude;
      metadata['longitude'] = point.longitude;
      if (config['mode'] != 'video' && config['exif'] == true) {
        final exif = await Exif.fromPath(target.path);
        try {
          await exif.writeAttributes({
            'GPSLatitude': '${point.latitude!.abs()}',
            'GPSLatitudeRef': point.latitude! >= 0 ? 'N' : 'S',
            'GPSLongitude': '${point.longitude!.abs()}',
            'GPSLongitudeRef': point.longitude! >= 0 ? 'E' : 'W',
            'DateTimeOriginal': now
                .substring(0, 19)
                .replaceAll('T', ' ')
                .replaceRange(0, 10, now.substring(0, 10).replaceAll('-', ':'))
          });
        } finally {
          await exif.close();
        }
      }
    }
    metadata['sha256'] =
        await sha256.bind(target.openRead()).first.then((d) => d.toString());
    await File('${target.path}.json').writeAsString(jsonEncode(metadata));
    return metadata;
  }

  Future<void> startAudio(int maxSeconds) async {
    if (!await _audio.hasPermission())
      throw StateError('Permiso de micrófono denegado');
    final dir = await getApplicationDocumentsDirectory();
    _audioPath = p.join(dir.path, '${const Uuid().v4()}.m4a');
    await _audio.start(
        const RecordConfig(
            encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
        path: _audioPath!);
    await _amplitudeSubscription?.cancel();
    _amplitudeSubscription = _audio
        .onAmplitudeChanged(const Duration(milliseconds: 100))
        .listen((v) => amplitude.add(v.current));
    _audioTimer =
        Timer(Duration(seconds: maxSeconds), () => unawaited(stopAudio()));
  }

  Future<Map<String, dynamic>> stopAudio() async {
    _audioTimer?.cancel();
    await _amplitudeSubscription?.cancel();
    final file = await _audio.stop() ?? _audioPath;
    if (file == null) throw StateError('No hay grabación');
    return {
      'path': file,
      'mime': 'audio/mp4',
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'sha256': await sha256
          .bind(File(file).openRead())
          .first
          .then((d) => d.toString())
    };
  }

  Future<Map<String, dynamic>> readNfc(Map<String, dynamic> config) async {
    try {
      final tag =
          await FlutterNfcKit.poll(timeout: const Duration(seconds: 20));
      final data = <String, dynamic>{
        'id': tag.id,
        'type': tag.type.toString(),
        'standard': tag.standard
      };
      if (tag.ndefAvailable ?? false)
        data['records'] = (await FlutterNfcKit.readNDEFRawRecords())
            .map((r) => r.toJson())
            .toList();
      return data;
    } finally {
      await FlutterNfcKit.finish();
    }
  }

  Future<void> startTracking(Map<String, dynamic> config) async {
    await stopTracking();
    await position();
    if (config['background'] == true &&
        !await _location.enableBackgroundMode(enable: true))
      throw StateError('No se autorizó la ubicación en segundo plano');
    await _location.changeSettings(
        accuracy: LocationAccuracy.high,
        interval: (config['intervalSeconds'] as int) * 1000,
        distanceFilter: 10);
    final api = _api!;
    if (config['transport'] == 'websocket') {
      _socket = io.io(
          '${ApiClient.base}/tracking',
          io.OptionBuilder()
              .setTransports(['websocket'])
              .setAuth({'token': await api.token()})
              .disableAutoConnect()
              .build())
        ..connect();
    } else {
      final endpoint = Uri.parse(config['endpoint'] as String);
      const allowedHost = String.fromEnvironment('MQTT_HOST');
      if (endpoint.scheme != 'mqtts' ||
          allowedHost.isEmpty ||
          endpoint.host != allowedHost)
        throw StateError('Servidor MQTT no autorizado para esta aplicación');
      _mqtt = MqttServerClient.withPort(endpoint.host, const Uuid().v4(),
          endpoint.hasPort ? endpoint.port : 8883)
        ..secure = true
        ..logging(on: false);
      await _mqtt!.connect(_scope, await api.token());
    }
    final fences = (config['geofences'] as List).cast<Map<String, dynamic>>();
    _locationSubscription = _location.onLocationChanged.listen((point) async {
      if (point.latitude == null || point.longitude == null) return;
      final data = {
        'deviceId': sha256.convert(utf8.encode(_scope!)).toString(),
        'latitude': point.latitude,
        'longitude': point.longitude,
        'capturedAt': DateTime.now().toUtc().toIso8601String()
      };
      try {
        if (_socket?.connected == true) {
          final acknowledgment = Completer<void>();
          _socket!.emitWithAck(
              'position', {'appId': ApiClient.appId, 'position': data},
              ack: (dynamic ack) {
            if (acknowledgment.isCompleted) return;
            if (ack is! Map || ack['id'] == null) {
              acknowledgment
                  .completeError(StateError('No se confirmó la posición'));
            } else {
              acknowledgment.complete();
            }
          });
          await acknowledgment.future.timeout(const Duration(seconds: 8));
        } else if (_mqtt?.connectionStatus?.state ==
            MqttConnectionState.connected) {
          final builder = MqttClientPayloadBuilder()
            ..addString(jsonEncode({
              'token': await api.token(),
              'appId': ApiClient.appId,
              'position': data
            }));
          _mqtt!.publishMessage(
              'superapp/${api.tenantId}/${ApiClient.appId}/positions',
              MqttQos.atLeastOnce,
              builder.payload!);
        } else {
          await enqueue('/gis/positions', data);
        }
        for (final fence in fences) {
          final inside = _meters(
                  point.latitude!,
                  point.longitude!,
                  (fence['latitude'] as num).toDouble(),
                  (fence['longitude'] as num).toDouble()) <=
              (fence['radiusMeters'] as num);
          if (inside && _inside[fence['id']] != true)
            await enqueue(
                '/gis/geofence', {'id': fence['id'], 'position': data});
          _inside[fence['id'] as String] = inside;
        }
      } catch (_) {
        await enqueue('/gis/positions', data);
      }
    });
  }

  double _meters(double a, double b, double c, double d) {
    final lat = (c - a) * pi / 180, lon = (d - b) * pi / 180;
    final h = pow(sin(lat / 2), 2) +
        cos(a * pi / 180) * cos(c * pi / 180) * pow(sin(lon / 2), 2);
    return 6371000 * 2 * atan2(sqrt(h), sqrt(1 - h));
  }

  Future<void> stopTracking() async {
    await _locationSubscription?.cancel();
    _locationSubscription = null;
    _socket?.dispose();
    _socket = null;
    _mqtt?.disconnect();
    _mqtt = null;
    _inside.clear();
  }

  Future<String> enqueue(String route, Object body) async {
    final id = const Uuid().v4();
    await _db!.insert('queue', {
      'id': id,
      'route': route,
      'body': jsonEncode(body),
      'state': 'pending'
    });
    unawaited(flush());
    return id;
  }

  Future<void> flush() async {
    if (_syncing || _api == null || _api!.namespace != _scope) return;
    _syncing = true;
    try {
      for (final item in await _db!.query('queue',
          where: 'state = ?', whereArgs: ['pending'], limit: 100)) {
        try {
          final body = await _uploadFiles(
              jsonDecode(item['body'] as String), item['id'] as String);
          await _db!.update('queue', {'body': jsonEncode(body)},
              where: 'id = ?', whereArgs: [item['id']]);
          await _api!.request('POST', item['route'] as String,
              body: body, idempotencyKey: item['id'] as String);
          await _db!.delete('queue', where: 'id = ?', whereArgs: [item['id']]);
        } on ApiException catch (e) {
          if (e.status == 400 ||
              e.status == 403 ||
              e.status == 404 ||
              e.status == 409) {
            await _db!.update('queue', {'state': 'rejected'},
                where: 'id = ?', whereArgs: [item['id']]);
          } else {
            break;
          }
        } catch (_) {
          break;
        }
      }
    } finally {
      _syncing = false;
    }
  }

  Future<List<Map<String, Object?>>> rejected() async =>
      _db!.query('queue', where: 'state = ?', whereArgs: ['rejected']);
  Future<dynamic> _uploadFiles(dynamic value, String key) async {
    if (value is Map<String, dynamic>) {
      if (value['path'] is String && value['mime'] is String) {
        final result = await _api!.upload(
            value['path'] as String,
            value['mime'] as String,
            const Uuid().v5(Namespace.url.value, key + value['path']));
        return {
          ...result,
          'timestamp': value['timestamp'],
          if (value['latitude'] != null) 'latitude': value['latitude'],
          if (value['longitude'] != null) 'longitude': value['longitude']
        };
      }
      final result = <String, dynamic>{};
      for (final entry in value.entries) {
        result[entry.key] = await _uploadFiles(entry.value, key + entry.key);
      }
      return result;
    }
    if (value is List) {
      final result = <dynamic>[];
      for (var i = 0; i < value.length; i++) {
        result.add(await _uploadFiles(value[i], '$key:$i'));
      }
      return result;
    }
    return value;
  }

  Future<Map<String, dynamic>> metadata() async {
    final rows =
        await _db!.query('cache', where: 'key = ?', whereArgs: ['metadata']);
    final cached = rows.isEmpty ? null : rows.first;
    try {
      final response = await _api!.request('GET', '/metadata',
          headers: cached?['etag'] == null
              ? {}
              : {'if-none-match': cached!['etag'] as String});
      if (response.statusCode == 304 && cached != null)
        return jsonDecode(cached['value'] as String);
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      await _db!.insert(
          'cache',
          {
            'key': 'metadata',
            'value': response.body,
            'etag': response.headers['etag']
          },
          conflictAlgorithm: ConflictAlgorithm.replace);
      return data;
    } on ApiException {
      rethrow;
    } catch (_) {
      if (cached != null) return jsonDecode(cached['value'] as String);
      rethrow;
    }
  }

  Future<void> close() async {
    _syncTimer?.cancel();
    await stopTracking();
    _audioTimer?.cancel();
    await _audio.stop();
    await _amplitudeSubscription?.cancel();
    while (_syncing) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    await _db?.close();
    _db = null;
    _api = null;
    _scope = null;
  }
}
