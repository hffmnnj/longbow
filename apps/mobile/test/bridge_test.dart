import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/bridge.dart';

void main() {
  group('BridgeRequest.parse', () {
    test('parses a full request', () {
      final req = BridgeRequest.parse(
        '{"id": 7, "method": "copy", "args": {"text": "https://x/?report=r1"}}',
      );
      expect(req.id, 7);
      expect(req.method, 'copy');
      expect(req.args, {'text': 'https://x/?report=r1'});
    });

    test('defaults missing args to an empty map', () {
      final req = BridgeRequest.parse('{"id": 1, "method": "badge"}');
      expect(req.args, isEmpty);
    });

    test('rejects non-objects, bad ids, bad methods, and bad args', () {
      expect(() => BridgeRequest.parse('[1, 2]'), throwsFormatException);
      expect(() => BridgeRequest.parse('nope'), throwsFormatException);
      expect(
        () => BridgeRequest.parse('{"id": "7", "method": "copy"}'),
        throwsFormatException,
      );
      expect(
        () => BridgeRequest.parse('{"id": 7, "method": ""}'),
        throwsFormatException,
      );
      expect(
        () => BridgeRequest.parse('{"id": 7}'),
        throwsFormatException,
      );
      expect(
        () => BridgeRequest.parse('{"id": 7, "method": "copy", "args": [1]}'),
        throwsFormatException,
      );
    });
  });

  group('bridgeReply', () {
    test('encodes an ok reply the web resolver understands', () {
      expect(
        bridgeReply(3, value: 'on'),
        'window.__longbowReply(3, {"ok":true,"value":"on"})',
      );
    });

    test('encodes an error reply and escapes its message', () {
      expect(
        bridgeReply(4, error: 'say "hi" \\ bye'),
        'window.__longbowReply(4, {"ok":false,"error":"say \\"hi\\" \\\\ bye"})',
      );
    });
  });

  group('resolveLaunchUrl', () {
    const base = 'https://longbow.example.ts.net:8443/';

    test('passes notification paths through against the base', () {
      expect(
        resolveLaunchUrl(base: base, path: '/?order=o1'),
        '$base?order=o1',
      );
    });

    test('falls back to base for null, empty, and unparsable urls', () {
      expect(resolveLaunchUrl(base: base), base);
      expect(resolveLaunchUrl(base: base, path: ''), base);
      expect(resolveLaunchUrl(base: base, path: '   '), base);
    });

    test('keeps same-origin absolute urls and rejects foreign ones', () {
      expect(
        resolveLaunchUrl(
          base: base,
          path: 'https://longbow.example.ts.net:8443/?report=r2',
        ),
        'https://longbow.example.ts.net:8443/?report=r2',
      );
      expect(
        resolveLaunchUrl(base: base, path: 'https://evil.example/o1'),
        base,
      );
      expect(
        resolveLaunchUrl(base: base, path: 'javascript:alert(1)'),
        base,
      );
    });
  });
}
