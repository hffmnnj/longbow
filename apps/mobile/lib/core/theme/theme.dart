import 'package:flutter/material.dart';

import 'tokens.dart';
import 'typography.dart';

export 'tokens.dart';
export 'typography.dart';

/// Minimum touch target on Android.
const double kMinTarget = 48;

/// Text-field outline. The `input` token is only ~1.7:1 on light surfaces, below
/// the 3:1 WCAG asks of UI boundaries, so fields use a stronger blend.
Color lbFieldBorder(LongbowColors c) => Color.alphaBlend(c.mutedForeground.withValues(alpha: 0.85), c.card);

/// Builds the Longbow Material 3 theme. Dark is the app default.
ThemeData buildLongbowTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? LongbowColors.dark : LongbowColors.light;
  final text = buildLongbowTextTheme(c);

  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.primary,
    onPrimary: c.primaryForeground,
    primaryContainer: c.accent,
    onPrimaryContainer: c.foreground,
    secondary: c.mutedForeground,
    onSecondary: c.background,
    secondaryContainer: c.accent,
    onSecondaryContainer: c.foreground,
    tertiary: c.lab,
    onTertiary: c.background,
    tertiaryContainer: c.labBg,
    onTertiaryContainer: c.lab,
    error: c.destructive,
    onError: c.primaryForeground,
    errorContainer: c.warnBg,
    onErrorContainer: c.destructive,
    surface: c.background,
    onSurface: c.foreground,
    onSurfaceVariant: c.mutedForeground,
    surfaceDim: c.background,
    surfaceBright: c.card,
    surfaceContainerLowest: c.background,
    surfaceContainerLow: c.card,
    surfaceContainer: c.card,
    surfaceContainerHigh: c.popover,
    surfaceContainerHighest: c.secondary,
    outline: c.input,
    outlineVariant: c.border,
    shadow: const Color(0xFF000000),
    scrim: const Color(0xFF000000),
    inverseSurface: c.foreground,
    onInverseSurface: c.background,
    inversePrimary: c.primary,
    surfaceTint: Colors.transparent,
  );

  final borderSide = BorderSide(color: c.border);
  final inputBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(LbRadius.md),
    borderSide: BorderSide(color: lbFieldBorder(c)),
  );
  const minSize = WidgetStatePropertyAll(Size(kMinTarget, kMinTarget));
  final shape = WidgetStatePropertyAll<OutlinedBorder>(
    RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.md)),
  );
  final buttonText = WidgetStatePropertyAll(text.labelLarge!.copyWith(fontSize: 14, fontWeight: FontWeight.w600));
  const buttonPadding = WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 18, vertical: 12));

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.background,
    canvasColor: c.background,
    fontFamily: kFontSans,
    textTheme: text,
    primaryTextTheme: text,
    extensions: <ThemeExtension<dynamic>>[c],
    splashFactory: InkSparkle.splashFactory,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    dividerColor: c.border,
    disabledColor: c.mutedForeground.withValues(alpha: 0.5),
    iconTheme: IconThemeData(color: c.foreground, size: 20),
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: c.bar,
      foregroundColor: c.foreground,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge,
      iconTheme: IconThemeData(color: c.foreground, size: 22),
      actionsIconTheme: IconThemeData(color: c.foreground, size: 22),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.bar,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 68,
      indicatorColor: c.accent,
      indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.lg)),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(
            size: 22,
            color: s.contains(WidgetState.selected) ? c.foreground : c.mutedForeground,
          )),
      labelTextStyle: WidgetStateProperty.resolveWith((s) => text.labelSmall!.copyWith(
            fontWeight: FontWeight.w500,
            color: s.contains(WidgetState.selected) ? c.foreground : c.mutedForeground,
          )),
    ),
    cardTheme: CardThemeData(
      color: c.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.lg), side: borderSide),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        minimumSize: minSize,
        padding: buttonPadding,
        shape: shape,
        textStyle: buttonText,
        elevation: const WidgetStatePropertyAll(0),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: ButtonStyle(
        minimumSize: minSize,
        padding: buttonPadding,
        shape: shape,
        textStyle: buttonText,
        foregroundColor: WidgetStatePropertyAll(c.foreground),
        side: WidgetStateProperty.resolveWith((s) => BorderSide(
              color: s.contains(WidgetState.disabled) ? c.border : c.input,
            )),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: ButtonStyle(
        minimumSize: minSize,
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
        shape: shape,
        textStyle: buttonText,
        foregroundColor: WidgetStatePropertyAll(c.primary),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: ButtonStyle(
        minimumSize: minSize,
        fixedSize: minSize,
        iconSize: const WidgetStatePropertyAll(22),
        shape: shape,
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        minimumSize: minSize,
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 12)),
        textStyle: WidgetStatePropertyAll(text.labelLarge!.copyWith(fontFamily: kFontMono, fontFeatures: const [FontFeature.tabularFigures()])),
        side: WidgetStatePropertyAll(BorderSide(color: c.border)),
        shape: shape,
        backgroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? c.accent : Colors.transparent),
        foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? c.foreground : c.mutedForeground),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? c.primaryForeground : c.mutedForeground),
      trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? c.primary : c.secondary),
      trackOutlineColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? c.primary : c.input),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: c.primary,
      inactiveTrackColor: c.secondary,
      thumbColor: c.primary,
      overlayColor: c.primary.withValues(alpha: 0.12),
      valueIndicatorColor: c.popover,
      valueIndicatorTextStyle: text.labelMedium,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.muted,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: inputBorder,
      enabledBorder: inputBorder,
      focusedBorder: inputBorder.copyWith(borderSide: BorderSide(color: c.primary, width: 2)),
      errorBorder: inputBorder.copyWith(borderSide: BorderSide(color: c.destructive)),
      focusedErrorBorder: inputBorder.copyWith(borderSide: BorderSide(color: c.destructive, width: 2)),
      disabledBorder: inputBorder.copyWith(borderSide: BorderSide(color: c.border)),
      labelStyle: text.bodySmall,
      floatingLabelStyle: text.labelMedium!.copyWith(color: c.mutedForeground),
      hintStyle: text.bodyMedium!.copyWith(color: c.mutedForeground),
      helperStyle: text.bodySmall,
      errorStyle: text.bodySmall!.copyWith(color: c.destructive),
      errorMaxLines: 3,
      helperMaxLines: 3,
      prefixIconColor: c.mutedForeground,
      suffixIconColor: c.mutedForeground,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.popover,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: c.popover,
      modalBarrierColor: Colors.black.withValues(alpha: 0.5),
      elevation: 0,
      showDragHandle: true,
      dragHandleColor: c.input,
      dragHandleSize: const Size(36, 4),
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(LbRadius.xl)),
        side: borderSide,
      ),
      clipBehavior: Clip.antiAlias,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.popover,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.xl), side: borderSide),
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium!.copyWith(color: c.mutedForeground),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.popover,
      contentTextStyle: text.bodyMedium,
      actionTextColor: c.primary,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.md), side: borderSide),
    ),
    listTileTheme: ListTileThemeData(
      minVerticalPadding: 8,
      minTileHeight: kMinTarget,
      contentPadding: const EdgeInsets.symmetric(horizontal: LbSpace.screen),
      iconColor: c.mutedForeground,
      textColor: c.foreground,
      titleTextStyle: text.bodyMedium,
      subtitleTextStyle: text.bodySmall,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.muted,
      selectedColor: c.accent,
      side: borderSide,
      labelStyle: text.labelMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.md)),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
    ),
    tabBarTheme: TabBarThemeData(
      dividerColor: c.border,
      indicatorColor: c.primary,
      indicatorSize: TabBarIndicatorSize.label,
      labelColor: c.foreground,
      unselectedLabelColor: c.mutedForeground,
      labelStyle: text.labelLarge!.copyWith(fontWeight: FontWeight.w600),
      unselectedLabelStyle: text.labelLarge,
      overlayColor: WidgetStatePropertyAll(c.accent.withValues(alpha: 0.5)),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: c.popover,
        borderRadius: BorderRadius.circular(LbRadius.sm),
        border: Border.fromBorderSide(borderSide),
      ),
      textStyle: text.labelMedium,
      waitDuration: const Duration(milliseconds: 400),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: c.primary,
      linearTrackColor: c.secondary,
      circularTrackColor: Colors.transparent,
      refreshBackgroundColor: c.popover,
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? c.primary : Colors.transparent),
      checkColor: WidgetStatePropertyAll(c.primaryForeground),
      side: BorderSide(color: c.input, width: 1.5),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: c.popover,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(LbRadius.md), side: borderSide),
      textStyle: text.bodyMedium,
    ),
    scrollbarTheme: ScrollbarThemeData(thumbColor: WidgetStatePropertyAll(c.input)),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
    }),
  );
}
