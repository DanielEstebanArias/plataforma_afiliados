import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_mobile/api_client.dart';
import 'package:superapp_mobile/sdui_parser.dart';

void main() {
  test('reject incompatible schema', () {
    expect(
        () => SduiParser(ApiClient()).validate(
            {'schemaVersion': '2.0', 'appId': ApiClient.appId, 'screens': []}),
        throwsFormatException);
  });
  test('reject duplicate component identifiers', () {
    expect(
        () => SduiParser(ApiClient()).validate({
              'schemaVersion': '1.0',
              'appId': ApiClient.appId,
              'screens': [
                {
                  'tree': {
                    'id': 'root',
                    'type': 'FLEX',
                    'children': [
                      {'id': 'same', 'type': 'TEXT'},
                      {'id': 'same', 'type': 'TEXT'}
                    ]
                  }
                }
              ]
            }),
        throwsFormatException);
  });
  test('accept bounded valid metadata', () {
    final data = {
      'schemaVersion': '1.0',
      'appId': ApiClient.appId,
      'screens': [
        {
          'route': '/',
          'tree': {'id': 'root', 'type': 'TEXT', 'text': 'Hello'}
        }
      ]
    };
    expect(SduiParser(ApiClient()).validate(data), same(data));
  });
}
