import 'package:json_annotation/json_annotation.dart';

part 'push.g.dart';

/// Payload the service worker shows as a notification.
@JsonSerializable(createToJson: false)
class PushPayload {
  const PushPayload({required this.title, required this.body, this.url, this.tag});

  factory PushPayload.fromJson(Map<String, dynamic> json) =>
      _$PushPayloadFromJson(json);

  final String title;
  final String body;

  /// Path to open on click, for example `/?order=<id>`.
  final String? url;

  /// Collapses repeats, for example `halt` or `order-<id>`.
  final String? tag;
}
