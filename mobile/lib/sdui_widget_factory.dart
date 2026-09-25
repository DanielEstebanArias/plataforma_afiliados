import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:uuid/uuid.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'api_client.dart';
import 'hardware_bridge.dart';

typedef ComponentBuilder = Widget Function(
    BuildContext, Map<String, dynamic>, Map<String, dynamic>);

class SduiWidgetFactory {
  final ApiClient api;
  final _builders = <String, ComponentBuilder>{};
  SduiWidgetFactory(this.api) {
    register('TEXT', (c, n, v) => Text(n['text'] as String));
    register(
        'INPUT_TEXT',
        (c, n, v) => TextFormField(
            decoration: InputDecoration(labelText: n['label'] as String),
            keyboardType: n['inputType'] == 'number'
                ? TextInputType.number
                : TextInputType.text,
            validator: (s) => n['required'] == true && (s == null || s.isEmpty)
                ? 'Campo obligatorio'
                : null,
            onChanged: (s) => v[n['field'] as String] =
                n['inputType'] == 'number' ? num.tryParse(s) : s));
    register('FLEX', (c, n, v) {
      final children = _children(c, n, v);
      return n['direction'] == 'row'
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: children.map((w) => Expanded(child: w)).toList())
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children);
    });
    register(
        'GRID',
        (c, n, v) => GridView.count(
            crossAxisCount: n['columns'] as int? ?? 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: _children(c, n, v)));
    register(
        'FORM',
        (c, n, v) => _DynamicForm(
            childBuilder: (values) => Column(children: _children(c, n, values)),
            submit: (values) => HardwareBridge.instance
                .enqueue('/records/${n['schemaId']}', values)));
    register(
        'BUTTON',
        (c, n, v) => _AsyncButton(
            label: n['label'] as String,
            action: () => action(c, n['action'] as Map<String, dynamic>, v)));
    register(
        'PAYMENT_BUTTON',
        (c, n, v) => _AsyncButton(
            label: n['label'] as String,
            action: () => action(c, n['action'] as Map<String, dynamic>, v)));
    register(
        'HARDWARE_BUTTON',
        (c, n, v) => _AsyncButton(
            label: n['label'] as String,
            action: () async {
              v[n['field'] as String] =
                  await hardware(c, n['handler'] as Map<String, dynamic>);
            }));
    register(
        'SIGNATURE_CANVAS',
        (c, n, v) =>
            SignatureCanvas(onSaved: (data) => v[n['field'] as String] = data));
    register(
        'GIS_MAP',
        (c, n, v) => Column(children: [
              SizedBox(
                  height: 300,
                  child: FlutterMap(
                      options: const MapOptions(
                          initialCenter: LatLng(4.711, -74.0721),
                          initialZoom: 12),
                      children: [
                        TileLayer(
                            urlTemplate:
                                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName:
                                const String.fromEnvironment('BUNDLE_ID')),
                        const RichAttributionWidget(attributions: [
                          TextSourceAttribution('OpenStreetMap contributors')
                        ])
                      ])),
              _AsyncButton(
                  label: 'Iniciar seguimiento',
                  action: () async {
                    await HardwareBridge.instance
                        .startTracking(n['handler'] as Map<String, dynamic>);
                  }),
              _AsyncButton(
                  label: 'Detener seguimiento',
                  action: HardwareBridge.instance.stopTracking)
            ]));
    register(
        'MODAL',
        (c, n, v) => TextButton(
            onPressed: () => showDialog<void>(
                context: c,
                builder: (context) => AlertDialog(
                        title: Text(n['label'] as String? ?? 'Detalle'),
                        content: SingleChildScrollView(
                            child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: _children(context, n, v))),
                        actions: [
                          TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Cerrar'))
                        ])),
            child: Text(n['label'] as String? ?? 'Abrir')));
    register('TABS', (c, n, v) {
      final children = _children(c, n, v);
      if (children.isEmpty) return const SizedBox.shrink();
      return DefaultTabController(
          length: children.length,
          child: Column(children: [
            TabBar(
                isScrollable: true,
                tabs: List.generate(
                    children.length, (i) => Tab(text: '${i + 1}'))),
            SizedBox(height: 400, child: TabBarView(children: children))
          ]));
    });
    register(
        'INFINITE_LIST',
        (c, n, v) =>
            _InfiniteRecords(api: api, schemaId: n['schemaId'] as String));
  }
  void register(String type, ComponentBuilder builder) =>
      _builders[type] = builder;
  Widget build(BuildContext context, Map<String, dynamic> node,
      Map<String, dynamic> values) {
    final builder = _builders[node['type']];
    return Padding(
        key: ValueKey(node['id']),
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: builder == null
            ? Text('Componente no disponible: ${node['type']}')
            : builder(context, node, values));
  }

  List<Widget> _children(
          BuildContext c, Map<String, dynamic> n, Map<String, dynamic> v) =>
      (n['children'] as List)
          .map((child) => build(c, Map<String, dynamic>.from(child), v))
          .toList();
  Future<Map<String, dynamic>> hardware(
      BuildContext context, Map<String, dynamic> config) async {
    if (config['kind'] == 'signature') {
      final value = await showDialog<Map<String, dynamic>>(
          context: context,
          builder: (dialogContext) => AlertDialog(
              title: const Text('Firma'),
              content: SizedBox(
                  width: 340,
                  child: SignatureCanvas(
                      onSaved: (data) => Navigator.pop(dialogContext, data)))));
      if (value == null) throw StateError('Firma cancelada');
      return value;
    }
    if (config['kind'] == 'scanner') {
      final value = await Navigator.push<String>(
          context, MaterialPageRoute(builder: (_) => const _Scanner()));
      if (value == null) throw StateError('Escaneo cancelado');
      return {'value': value};
    }
    if (config['kind'] == 'audio') {
      final data = await showDialog<Map<String, dynamic>>(
          context: context,
          barrierDismissible: false,
          builder: (_) =>
              _AudioDialog(maxSeconds: config['maxSeconds'] as int));
      if (data == null) throw StateError('Grabación cancelada');
      return data;
    }
    return HardwareBridge.instance.execute(config);
  }

  Future<void> action(BuildContext context, Map<String, dynamic> action,
      Map<String, dynamic> values) async {
    switch (action['type']) {
      case 'NAVIGATE':
        await Navigator.pushNamed(context, action['route'] as String);
        break;
      case 'SUBMIT':
        await HardwareBridge.instance
            .enqueue('/records/${action['schemaId']}', values);
        break;
      case 'HARDWARE':
        values[action['field'] as String] =
            await hardware(context, action['handler'] as Map<String, dynamic>);
        break;
      case 'PAY':
        final customer = await showDialog<Map<String, String>>(
            context: context, builder: (_) => const _CustomerDialog());
        if (customer == null) return;
        final result = jsonDecode((await api.request(
                'POST', '/payments/checkout',
                body: {'offerId': action['offerId'], 'customer': customer},
                idempotencyKey: const Uuid().v4()))
            .body) as Map<String, dynamic>;
        if (!context.mounted) return;
        final providerId = await Navigator.push<String>(context,
            MaterialPageRoute(builder: (_) => _Checkout(result: result)));
        final status = jsonDecode((await api.request(
                'POST', '/payments/${result['id']}/reconcile',
                body: providerId == null ? {} : {'providerId': providerId}))
            .body);
        if (context.mounted)
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(status['status'] == 'PAID'
                  ? 'Pago confirmado'
                  : 'Pago pendiente de confirmación')));
        break;
      default:
        throw UnsupportedError('Acción no soportada');
    }
  }
}

class _AsyncButton extends StatefulWidget {
  final String label;
  final Future<void> Function() action;
  const _AsyncButton({required this.label, required this.action});
  @override
  State<_AsyncButton> createState() => _AsyncButtonState();
}

class _AsyncButtonState extends State<_AsyncButton> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => FilledButton(
      onPressed: busy
          ? null
          : () async {
              setState(() => busy = true);
              try {
                await widget.action();
              } catch (e) {
                if (mounted)
                  ScaffoldMessenger.of(context)
                      .showSnackBar(SnackBar(content: Text('$e')));
              } finally {
                if (mounted) setState(() => busy = false);
              }
            },
      child: Text(busy ? 'Procesando…' : widget.label));
}

class _DynamicForm extends StatefulWidget {
  final Widget Function(Map<String, dynamic>) childBuilder;
  final Future<String> Function(Map<String, dynamic>) submit;
  const _DynamicForm({required this.childBuilder, required this.submit});
  @override
  State<_DynamicForm> createState() => _DynamicFormState();
}

class _DynamicFormState extends State<_DynamicForm> {
  final key = GlobalKey<FormState>();
  final values = <String, dynamic>{};
  @override
  Widget build(BuildContext context) => Form(
      key: key,
      child: Column(children: [
        widget.childBuilder(values),
        _AsyncButton(
            label: 'Enviar',
            action: () async {
              if (!key.currentState!.validate()) return;
              await widget.submit(values);
              if (mounted)
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Guardado para sincronización')));
            })
      ]));
}

class SignatureCanvas extends StatefulWidget {
  final void Function(Map<String, dynamic>) onSaved;
  const SignatureCanvas({super.key, required this.onSaved});
  @override
  State<SignatureCanvas> createState() => _SignatureCanvasState();
}

class _SignatureCanvasState extends State<SignatureCanvas> {
  final points = <Offset?>[];
  @override
  Widget build(BuildContext context) => Column(children: [
        SizedBox(
            height: 180,
            width: 320,
            child: GestureDetector(
                onPanStart: (d) => setState(() => points.add(d.localPosition)),
                onPanUpdate: (d) => setState(() => points.add(d.localPosition)),
                onPanEnd: (_) => setState(() => points.add(null)),
                child: CustomPaint(
                    painter: _SignaturePainter(points),
                    child: const SizedBox.expand()))),
        Row(children: [
          TextButton(
              onPressed: () => setState(points.clear),
              child: const Text('Borrar')),
          _AsyncButton(
              label: 'Guardar firma',
              action: () async {
                if (points.whereType<Offset>().length < 2)
                  throw StateError('Firma vacía');
                final commands = StringBuffer();
                bool start = true;
                for (final point in points) {
                  if (point == null) {
                    start = true;
                  } else {
                    commands.write(
                        '${start ? 'M' : 'L'}${point.dx.toStringAsFixed(2)},${point.dy.toStringAsFixed(2)} ');
                    start = false;
                  }
                }
                final svg =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path d="$commands" fill="none" stroke="black" stroke-width="2"/></svg>';
                final recorder = ui.PictureRecorder();
                _SignaturePainter(points)
                    .paint(Canvas(recorder), const Size(320, 180));
                final picture = recorder.endRecording();
                final image = await picture.toImage(320, 180);
                final bytes =
                    await image.toByteData(format: ui.ImageByteFormat.png);
                image.dispose();
                picture.dispose();
                widget.onSaved({
                  'svg': svg,
                  'png': base64Encode(bytes!.buffer.asUint8List()),
                  'sha256': sha256.convert(utf8.encode(svg)).toString(),
                  'timestamp': DateTime.now().toUtc().toIso8601String()
                });
              })
        ])
      ]);
}

class _SignaturePainter extends CustomPainter {
  final List<Offset?> points;
  _SignaturePainter(this.points);
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    canvas.clipRect(Offset.zero & size);
    final pen = Paint()
      ..color = Colors.black
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (var i = 1; i < points.length; i++) {
      if (points[i - 1] != null && points[i] != null)
        canvas.drawLine(points[i - 1]!, points[i]!, pen);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter oldDelegate) => true;
}

class _Scanner extends StatefulWidget {
  const _Scanner();
  @override
  State<_Scanner> createState() => _ScannerState();
}

class _ScannerState extends State<_Scanner> {
  bool done = false;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Escanear código')),
      body: MobileScanner(onDetect: (capture) {
        if (done) return;
        for (final code in capture.barcodes) {
          if (code.rawValue != null) {
            done = true;
            Navigator.pop(context, code.rawValue);
            break;
          }
        }
      }));
}

class _AudioDialog extends StatefulWidget {
  final int maxSeconds;
  const _AudioDialog({required this.maxSeconds});
  @override
  State<_AudioDialog> createState() => _AudioDialogState();
}

class _AudioDialogState extends State<_AudioDialog> {
  bool recording = false;
  final levels = <double>[];
  @override
  Widget build(BuildContext context) => AlertDialog(
          title: const Text('Grabar audio'),
          content: SizedBox(
              width: 300,
              height: 120,
              child: StreamBuilder<double>(
                  stream: HardwareBridge.instance.amplitude.stream,
                  builder: (c, s) {
                    levels.add(((s.data ?? -60) + 60).clamp(0, 60) / 60);
                    if (levels.length > 50) levels.removeAt(0);
                    return Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: levels
                            .map((v) => Expanded(
                                child: Container(
                                    margin: const EdgeInsets.all(1),
                                    height: 2 + v * 100,
                                    color: Colors.blue)))
                            .toList());
                  })),
          actions: [
            _AsyncButton(
                label: recording ? 'Guardar' : 'Grabar',
                action: () async {
                  if (!recording) {
                    await HardwareBridge.instance.startAudio(widget.maxSeconds);
                    setState(() => recording = true);
                  } else {
                    final value = await HardwareBridge.instance.stopAudio();
                    if (context.mounted) Navigator.pop(context, value);
                  }
                }),
            TextButton(
                onPressed: () async {
                  if (recording) await HardwareBridge.instance.stopAudio();
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Cancelar'))
          ]);
}

class _InfiniteRecords extends StatefulWidget {
  final ApiClient api;
  final String schemaId;
  const _InfiniteRecords({required this.api, required this.schemaId});
  @override
  State<_InfiniteRecords> createState() => _InfiniteRecordsState();
}

class _InfiniteRecordsState extends State<_InfiniteRecords> {
  final items = <dynamic>[];
  String? cursor;
  bool ended = false, busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Future<void> load() async {
    if (busy || ended) return;
    setState(() => busy = true);
    try {
      final data = jsonDecode((await widget.api.request('GET',
              '/records/${widget.schemaId}${cursor == null ? '' : '?cursor=$cursor'}'))
          .body);
      if (!mounted) return;
      setState(() {
        items.addAll(data['items'] as List);
        cursor = data['nextCursor'] as String?;
        ended = cursor == null;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SizedBox(
      height: 360,
      child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            if (n.metrics.extentAfter < 200) unawaited(load());
            return false;
          },
          child: ListView.builder(
              itemCount: items.length + 1,
              itemBuilder: (c, i) => i < items.length
                  ? ListTile(title: Text(jsonEncode(items[i]['data'])))
                  : error != null
                      ? TextButton(onPressed: load, child: Text(error!))
                      : busy
                          ? const Center(child: CircularProgressIndicator())
                          : const SizedBox.shrink())));
}

class _CustomerDialog extends StatefulWidget {
  const _CustomerDialog();
  @override
  State<_CustomerDialog> createState() => _CustomerDialogState();
}

class _CustomerDialogState extends State<_CustomerDialog> {
  final key = GlobalKey<FormState>();
  final values = <String, String>{};
  @override
  Widget build(BuildContext context) => AlertDialog(
          title: const Text('Datos del comprador'),
          content: Form(
              key: key,
              child: SingleChildScrollView(
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: {
                        'email': 'Correo',
                        'name': 'Nombre',
                        'phone': 'Teléfono',
                        'document': 'Documento'
                      }
                          .entries
                          .map((e) => TextFormField(
                              decoration: InputDecoration(labelText: e.value),
                              validator: (s) => s == null || s.trim().isEmpty
                                  ? 'Campo obligatorio'
                                  : null,
                              onChanged: (s) => values[e.key] = s))
                          .toList()))),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancelar')),
            FilledButton(
                onPressed: () {
                  if (key.currentState!.validate())
                    Navigator.pop(context, values);
                },
                child: const Text('Continuar'))
          ]);
}

class _Checkout extends StatefulWidget {
  final Map<String, dynamic> result;
  const _Checkout({required this.result});
  @override
  State<_Checkout> createState() => _CheckoutState();
}

class _CheckoutState extends State<_Checkout> {
  late final WebViewController controller;
  String escape(String s) => s
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
          NavigationDelegate(onNavigationRequest: (request) {
        final uri = Uri.parse(request.url);
        final returnUri =
            Uri.parse(const String.fromEnvironment('PAYMENT_RETURN_URL'));
        if (uri.origin == returnUri.origin && uri.path == returnUri.path) {
          Navigator.pop(context, uri.queryParameters['id']);
          return NavigationDecision.prevent;
        }
        return uri.scheme == 'https'
            ? NavigationDecision.navigate
            : NavigationDecision.prevent;
      }));
    final url = Uri.parse(widget.result['url'] as String);
    if (url.scheme != 'https') throw StateError('Checkout inválido');
    final form = widget.result['form'] as Map<String, dynamic>?;
    if (form == null) {
      controller.loadRequest(url);
    } else {
      controller.loadHtmlString(
          '<html><body><form method="post" action="${escape(url.toString())}">${form.entries.map((e) => '<input type="hidden" name="${escape(e.key)}" value="${escape(e.value.toString())}">').join()}<button type="submit">Continuar al pago seguro</button></form></body></html>');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Pago seguro')),
      body: WebViewWidget(controller: controller));
}
