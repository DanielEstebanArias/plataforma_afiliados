import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

class ApiClient {
  static const base = String.fromEnvironment('API_URL');
  static const appId = String.fromEnvironment('APP_ID');
  static const issuer = String.fromEnvironment('OIDC_ISSUER');
  static const clientId = String.fromEnvironment('OIDC_CLIENT_ID');
  static const redirect = String.fromEnvironment('OIDC_REDIRECT_URI');
  final _auth = const FlutterAppAuth();
  final _storage = const FlutterSecureStorage();
  String? _access;
  DateTime? _expires;
  String? namespace;
  String? tenantId;
  Future<void> login() async {
    final result =
        await _auth.authorizeAndExchangeCode(AuthorizationTokenRequest(
      clientId,
      redirect,
      issuer: issuer,
      scopes: ['openid', 'profile', 'offline_access'],
      additionalParameters: {
        'audience': const String.fromEnvironment('OIDC_AUDIENCE')
      },
    ));
    if (result.accessToken == null)
      throw StateError('Inicio de sesión cancelado');
    await _accept(result.accessToken!, result.refreshToken,
        result.accessTokenExpirationDateTime);
  }

  Future<void> _accept(String token, String? refresh, DateTime? expires) async {
    final claims = jsonDecode(utf8
            .decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))))
        as Map<String, dynamic>;
    if (claims['tenant_id'] == null || claims['sub'] == null)
      throw StateError('Token sin contexto');
    namespace = '${claims['tenant_id']}:${claims['sub']}:$appId';
    tenantId = claims['tenant_id'] as String;
    _access = token;
    _expires = expires;
    if (refresh != null)
      await _storage.write(key: 'refresh:$appId', value: refresh);
  }

  Future<String> token() async {
    if (_access != null &&
        _expires != null &&
        _expires!.isAfter(DateTime.now().add(const Duration(minutes: 1))))
      return _access!;
    final refresh = await _storage.read(key: 'refresh:$appId');
    if (refresh == null) throw ApiException(401, 'Inicia sesión');
    final result = await _auth.token(TokenRequest(clientId, redirect,
        issuer: issuer, refreshToken: refresh));
    if (result.accessToken == null) throw ApiException(401, 'Sesión expirada');
    await _accept(result.accessToken!, result.refreshToken,
        result.accessTokenExpirationDateTime);
    return _access!;
  }

  Future<http.Response> request(String method, String route,
      {Object? body,
      String? idempotencyKey,
      Map<String, String> headers = const {}}) async {
    final uri = Uri.parse('$base/api/apps/$appId$route');
    if (uri.scheme != 'https') throw StateError('Se requiere HTTPS');
    final req = http.Request(method, uri)
      ..headers.addAll({
        'authorization': 'Bearer ${await token()}',
        'content-type': 'application/json',
        ...headers
      });
    if (idempotencyKey != null) req.headers['idempotency-key'] = idempotencyKey;
    if (body != null) req.body = jsonEncode(body);
    final client = http.Client();
    try {
      final response = await http.Response.fromStream(
          await client.send(req).timeout(const Duration(seconds: 30)));
      if (response.statusCode >= 400)
        throw ApiException(response.statusCode,
            'Solicitud rechazada (${response.statusCode})');
      return response;
    } finally {
      client.close();
    }
  }

  Future<void> logout() async {
    await _storage.delete(key: 'refresh:$appId');
    _access = null;
    _expires = null;
    namespace = null;
  }

  Future<Map<String, dynamic>> upload(
      String path, String mime, String id) async {
    final file = File(path), uri = Uri.parse('$base/api/apps/$appId/assets');
    if (uri.scheme != 'https') throw StateError('Se requiere HTTPS');
    final request = http.StreamedRequest('POST', uri)
      ..headers.addAll({
        'authorization': 'Bearer ${await token()}',
        'content-type': mime,
        'idempotency-key': id
      })
      ..contentLength = await file.length();
    final client = http.Client();
    try {
      final responseFuture = client.send(request);
      await request.sink.addStream(file.openRead());
      await request.sink.close();
      final response = await http.Response.fromStream(await responseFuture);
      if (response.statusCode >= 400)
        throw ApiException(response.statusCode, 'No se pudo enviar el archivo');
      return jsonDecode(response.body) as Map<String, dynamic>;
    } finally {
      client.close();
    }
  }
}
