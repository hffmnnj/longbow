import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/native/native_bridge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('longbow/native');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  NativeBridge bridgeWith(Object? Function(MethodCall) reply) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => reply(call));
    return NativeBridge();
  }

  test('notificationsStatus maps on/off/blocked, unknown reads as off', () async {
    for (final entry in {
      'on': NotificationState.on,
      'off': NotificationState.off,
      'blocked': NotificationState.blocked,
      'weird': NotificationState.off,
    }.entries) {
      final bridge = bridgeWith((_) => entry.key);
      expect(await bridge.notificationsStatus(), entry.value);
      bridge.dispose();
    }
  });

  test('every call is a safe no-op without a channel', () async {
    final bridge = NativeBridge(channel: const MethodChannel('longbow/missing'));
    expect(await bridge.notificationsStatus(), NotificationState.off);
    expect(await bridge.openTailscale(), isFalse);
    expect(await bridge.initialLink(), isNull);
    await bridge.enableNotifications('https://longbow.example.ts.net:8443');
    await bridge.disableNotifications();
    await bridge.setBaseUrl('https://longbow.example.ts.net:8443');
    bridge.dispose();
  });

  test('enable and setBaseUrl forward the base URL', () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });
    final bridge = NativeBridge();
    await bridge.enableNotifications('https://longbow.example.ts.net:8443');
    await bridge.setBaseUrl('https://longbow.example.ts.net:8443');
    await bridge.disableNotifications();
    expect(calls.map((c) => c.method),
        ['notificationsEnable', 'setBaseUrl', 'notificationsDisable']);
    expect(calls[0].arguments,
        {'baseUrl': 'https://longbow.example.ts.net:8443'});
    bridge.dispose();
  });

  test('openTailscale and initialLink return native values', () async {
    final bridge = bridgeWith((call) => switch (call.method) {
          'openTailscale' => true,
          'getInitialUrl' => '/?order=o1',
          _ => null,
        });
    expect(await bridge.openTailscale(), isTrue);
    expect(await bridge.initialLink(), '/?order=o1');
    bridge.dispose();
  });

  test('incoming openUrl calls surface on links', () async {
    final bridge = bridgeWith((_) => null);
    final future = bridge.links.first;
    await TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .handlePlatformMessage(
          channel.name,
          const StandardMethodCodec().encodeMethodCall(
            const MethodCall('openUrl', {'url': '/?report=r1'}),
          ),
          (_) {},
        );
    expect(await future, '/?report=r1');
    bridge.dispose();
  });

  test('incoming openUrl without a URL is ignored', () async {
    final bridge = bridgeWith((_) => null);
    var seen = false;
    final sub = bridge.links.listen((_) => seen = true);
    await TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .handlePlatformMessage(
          channel.name,
          const StandardMethodCodec()
              .encodeMethodCall(const MethodCall('openUrl', {})),
          (_) {},
        );
    await Future<void>.delayed(Duration.zero);
    expect(seen, isFalse);
    await sub.cancel();
    bridge.dispose();
  });
}
