import 'package:flutter/material.dart';
import 'api_client.dart';
import 'hardware_bridge.dart';
import 'sdui_parser.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SuperApp());
}

class SuperApp extends StatefulWidget {
  const SuperApp({super.key});
  @override
  State<SuperApp> createState() => _SuperAppState();
}

class _SuperAppState extends State<SuperApp> {
  final api = ApiClient();
  Map<String, dynamic>? config;
  String? error;
  bool loading = false;
  Future<void> login() async {
    setState(() => loading = true);
    try {
      await api.login();
      await HardwareBridge.instance.initialize(api);
      final data = await HardwareBridge.instance.metadata();
      setState(() {
        config = SduiParser(api).validate(data);
        error = null;
      });
    } catch (e) {
      setState(() => error = '$e');
    } finally {
      setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = config?['theme'] as Map<String, dynamic>?;
    final screens =
        (config?['screens'] as List? ?? []).cast<Map<String, dynamic>>();
    final parser = SduiParser(api);
    return MaterialApp(
        title:
            const String.fromEnvironment('APP_NAME', defaultValue: 'SuperApp'),
        theme: ThemeData(
            useMaterial3: true,
            fontFamily: theme?['fontFamily'] as String?,
            scaffoldBackgroundColor: Color(int.parse(
                'FF${(theme?['background'] as String? ?? '#FFFFFF').substring(1)}',
                radix: 16)),
            inputDecorationTheme: InputDecorationTheme(
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                        (theme?['radius'] as num? ?? 12).toDouble()))),
            filledButtonTheme: FilledButtonThemeData(
                style: FilledButton.styleFrom(
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(
                            (theme?['radius'] as num? ?? 12).toDouble())))),
            colorScheme: ColorScheme.fromSeed(seedColor: Color(int.parse('FF${(theme?['primary'] as String? ?? '#2563EB').substring(1)}', radix: 16)))),
        onGenerateRoute: (settings) {
          final selected = screens.where((s) => s['route'] == settings.name);
          final screen = selected.isEmpty
              ? (screens.isEmpty ? null : screens.first)
              : selected.first;
          return MaterialPageRoute(
              builder: (context) => Scaffold(
                  appBar: AppBar(
                      leading: Image.asset('assets/brand.png',
                          errorBuilder: (_, error, stack) =>
                              const Icon(Icons.apps)),
                      title: Text(screen?['title'] as String? ?? 'SuperApp'),
                      actions: [
                        if (config != null)
                          IconButton(
                              icon: const Icon(Icons.sync),
                              onPressed: () async {
                                try {
                                  await HardwareBridge.instance.flush();
                                  final data =
                                      await HardwareBridge.instance.metadata();
                                  final rejected =
                                      await HardwareBridge.instance.rejected();
                                  setState(
                                      () => config = parser.validate(data));
                                  if (context.mounted && rejected.isNotEmpty)
                                    ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(
                                            content: Text(
                                                '${rejected.length} envíos requieren revisión')));
                                } catch (e) {
                                  if (context.mounted)
                                    ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text('$e')));
                                }
                              }),
                        if (config != null)
                          IconButton(
                              icon: const Icon(Icons.logout),
                              onPressed: () async {
                                await HardwareBridge.instance.close();
                                await api.logout();
                                setState(() => config = null);
                              })
                      ]),
                  body: config == null
                      ? Center(
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                          if (error != null) Text(error!),
                          FilledButton(
                              onPressed: loading ? null : login,
                              child: Text(
                                  loading ? 'Conectando…' : 'Iniciar sesión'))
                        ]))
                      : screen == null
                          ? const Center(
                              child:
                                  Text('Publica una pantalla desde el portal'))
                          : parser.screen(context, screen)));
        });
  }
}
