import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('push_parsesNotificationPayload', () {
    final payload = PushPayload.fromJson({
      'title': 'Order filled',
      'body': 'SPY buy 0.65 @ 759.40',
      'url': '/?order=ord-handbuilt-001',
      'tag': 'order-ord-handbuilt-001',
    });

    expect(payload.title, 'Order filled');
    expect(payload.body, contains('SPY'));
    expect(payload.url, '/?order=ord-handbuilt-001');
    expect(payload.tag, 'order-ord-handbuilt-001');
  });

  test('push_optionalsDefaultToNull', () {
    final payload = PushPayload.fromJson({'title': 'Halted', 'body': 'Kill switch on'});

    expect(payload.url, isNull);
    expect(payload.tag, isNull);
  });
}
