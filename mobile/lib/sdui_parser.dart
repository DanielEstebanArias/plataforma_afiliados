import 'package:flutter/material.dart';
import 'api_client.dart';
import 'sdui_widget_factory.dart';

class SduiParser {
  final ApiClient api;
  late final SduiWidgetFactory factory = SduiWidgetFactory(api);
  SduiParser(this.api);
  Map<String, dynamic> validate(Map<String, dynamic> config) {
    if (config['schemaVersion'] != '1.0' || config['appId'] != ApiClient.appId)
      throw const FormatException('Metadatos incompatibles');
    final screens = config['screens'];
    if (screens is! List || screens.length > 100)
      throw const FormatException('Pantallas inválidas');
    for (final screen in screens) {
      var count = 0;
      final ids = <String>{};
      void visit(dynamic node, int depth) {
        if (node is! Map || depth > 20 || ++count > 500)
          throw const FormatException('Árbol inválido');
        if (!ids.add(node['id'] as String))
          throw const FormatException('ID duplicado');
        for (final child in (node['children'] as List? ?? [])) {
          visit(child, depth + 1);
        }
      }

      visit(screen['tree'], 0);
    }
    return config;
  }

  Widget screen(BuildContext context, Map<String, dynamic> screen) {
    final values = <String, dynamic>{};
    return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: factory.build(
            context, Map<String, dynamic>.from(screen['tree']), values));
  }
}
