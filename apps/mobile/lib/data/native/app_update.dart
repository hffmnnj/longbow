/// What the Kotlin updater (AppUpdater) reports for the connected server.
enum UpdateStatus { idle, checking, downloading, ready, current, error, offline }

/// What happened when the user tapped Install.
enum InstallOutcome {
  /// The system installer is open on the verified file.
  started,

  /// Android has not yet allowed this app to install packages.
  needsPermission,

  /// Nothing verified is waiting (the state moved on, or the file was removed).
  notReady,

  /// The file failed its checks again; the updater state carries the reason.
  invalid,
}

class ReleaseNotes {
  const ReleaseNotes({
    required this.id,
    required this.version,
    required this.title,
    required this.notes,
    required this.publishedAt,
  });

  final String id;
  final String version;
  final String title;
  final String notes;
  final DateTime publishedAt;
}

class AndroidBuild {
  const AndroidBuild({required this.versionCode, required this.versionName, required this.size});

  final int versionCode;
  final String versionName;
  final int size;
}

/// A snapshot of the updater. Parsed from the native map; anything missing or
/// of the wrong type reads as its empty value, never throws.
class AppUpdateState {
  const AppUpdateState({
    this.status = UpdateStatus.idle,
    this.errorCode,
    this.errorMessage,
    this.release,
    this.android,
    this.downloaded = 0,
    this.installedVersionCode,
    this.installedVersionName = '',
    this.canInstall = true,
    this.installDenied = false,
    this.installing = false,
  });

  factory AppUpdateState.fromMap(Object? raw, {bool installDenied = false, bool installing = false}) {
    if (raw is! Map) return AppUpdateState(installDenied: installDenied, installing: installing);
    final release = raw['release'];
    final android = raw['android'];
    final canInstall = raw['canInstall'] != false;
    return AppUpdateState(
      status: UpdateStatus.values.asNameMap()[raw['status']] ?? UpdateStatus.idle,
      errorCode: raw['errorCode'] as String?,
      errorMessage: raw['errorMessage'] as String?,
      release: release is Map ? _release(release) : null,
      android: android is Map ? _android(android) : null,
      downloaded: _int(raw['downloaded']) ?? 0,
      installedVersionCode: _int(raw['installedVersionCode']),
      installedVersionName: raw['installedVersionName'] as String? ?? '',
      canInstall: canInstall,
      // Android's own switch is the truth: once it is on, the denial is over.
      installDenied: installDenied && !canInstall,
      installing: installing,
    );
  }

  static int? _int(Object? v) => v is num ? v.toInt() : null;

  static ReleaseNotes? _release(Map m) {
    final id = m['id'];
    final version = m['version'];
    if (id is! String || version is! String) return null;
    return ReleaseNotes(
      id: id,
      version: version,
      title: m['title'] as String? ?? '',
      notes: m['notes'] as String? ?? '',
      publishedAt: DateTime.fromMillisecondsSinceEpoch(_int(m['publishedAt']) ?? 0),
    );
  }

  static AndroidBuild? _android(Map m) {
    final code = _int(m['versionCode']);
    if (code == null) return null;
    return AndroidBuild(versionCode: code, versionName: m['versionName'] as String? ?? '', size: _int(m['size']) ?? 0);
  }

  final UpdateStatus status;
  final String? errorCode;
  final String? errorMessage;
  final ReleaseNotes? release;
  final AndroidBuild? android;
  final int downloaded;
  final int? installedVersionCode;
  final String installedVersionName;
  final bool canInstall;

  /// The user tapped Install and Android has not allowed installs yet.
  final bool installDenied;

  /// An Install tap is being verified.
  final bool installing;

  /// 0..1 while downloading, null when the total is unknown.
  double? get progress {
    final total = android?.size ?? 0;
    if (status != UpdateStatus.downloading || total <= 0) return null;
    return (downloaded / total).clamp(0.0, 1.0);
  }

  /// "1.0.1 (2)", or just the name before the build number is known.
  String get installedLabel {
    final code = installedVersionCode;
    if (installedVersionName.isEmpty) return code == null ? '\u2014' : '($code)';
    return code == null ? installedVersionName : '$installedVersionName ($code)';
  }

  AppUpdateState copyWith({
    UpdateStatus? status,
    String? errorCode,
    String? errorMessage,
    ReleaseNotes? release,
    AndroidBuild? android,
    int? downloaded,
    int? installedVersionCode,
    String? installedVersionName,
    bool? canInstall,
    bool? installDenied,
    bool? installing,
  }) =>
      AppUpdateState(
        status: status ?? this.status,
        errorCode: errorCode ?? this.errorCode,
        errorMessage: errorMessage ?? this.errorMessage,
        release: release ?? this.release,
        android: android ?? this.android,
        downloaded: downloaded ?? this.downloaded,
        installedVersionCode: installedVersionCode ?? this.installedVersionCode,
        installedVersionName: installedVersionName ?? this.installedVersionName,
        canInstall: canInstall ?? this.canInstall,
        installDenied: installDenied ?? this.installDenied,
        installing: installing ?? this.installing,
      );
}
