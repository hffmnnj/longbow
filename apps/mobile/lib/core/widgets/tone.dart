import 'package:flutter/widgets.dart';

import '../format.dart';
import '../theme/theme.dart';

/// Maps a [Tone] to its token color: gain, loss, or muted for flat.
extension LbToneColor on LongbowColors {
  Color forTone(Tone t) => switch (t) {
        Tone.gain => gain,
        Tone.loss => loss,
        Tone.flat => mutedForeground,
      };
}

/// Convenience for call sites that only have a context.
Color toneColor(BuildContext context, Tone t) => context.lb.forTone(t);
