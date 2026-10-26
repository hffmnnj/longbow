/// Longbow chart kit: dithered charts drawn with `CustomPainter`, the native
/// port of the web app's dither-kit look (a crisp line over an ordered-dither
/// dot fill). Feature screens import only this file.
///
/// Inventory of web charts and the widget that covers each:
///
/// - PriceChart (candles, volume, SMA 20/50/200, stop and entry lines, entry
///   and exit markers; symbol sheet, report trade path) -> [CandleChart]
/// - MiniChart / PriceChart `mini` (3 month close line on order cards, with
///   limit and invalidation lines) -> [DitherAreaChart] with [referenceLines]
/// - EquityChart (lab run equity against SPY, buy and sell fill markers, start
///   line) -> [DitherAreaChart] with `benchmark`, `markers`, `referenceLines`
/// - CompareChart (lab compare, several runs normalised to 100) ->
///   [MultiLineChart]
/// - DitherSeries `area` (portfolio equity, VIX history, 10Y yield history)
///   -> [DitherAreaChart]
/// - DitherSeries `line` (Treasury yield curve by tenor) -> [CurveChart]
/// - DitherSpark / Sparkline / TrendTable spark (one month and three month
///   trends in rows) and RunSpark (equity vs SPY on run cards) -> [Sparkline]
///   (`benchmark` for RunSpark)
/// - DitherColumns (P&L per trade stacked win/loss, calibration buckets,
///   exposure columns) -> [ColumnChart]
/// - Calibration (predicted against realized) -> [CalibrationChart] (plus
///   [ColumnChart] when a grouped column view is wanted)
/// - DitherBar (position exposure, cash, sector weight against its cap,
///   market breadth against 50, VIX term structure, order outcome counts)
///   -> [BarStrip] / [BarStripList]
/// - ExcessStrip (lab suite excess return dots per variant) -> [ExcessStrip]
///   and [DiffBars] for signed bar rows
///
/// Not covered: `RangeToggle` (a segmented control; belongs to the design
/// system widgets) and the dither kit's pie, radar and decorative canvases
/// (the web app does not use them).
library;

export 'bar_strips.dart'
    show BarRow, BarStrip, BarStripList, DiffBarRow, DiffBars, barFraction;
export 'calibration_chart.dart' show CalibrationChart, CalibrationPoint;
export 'candle_chart.dart' show CandleBar, CandleChart, aggregateCandles;
export 'cartesian_chart.dart'
    show ChartLine, ChartMarker, ChartMarkerKind, ChartReferenceLine;
export 'chart_format.dart'
    show formatChange, formatChartNumber, summarizeSeries;
export 'chart_math.dart'
    show
        LinearScale,
        decimateMinMax,
        niceTicks,
        paddedDomain,
        pickLabelIndices,
        simpleMovingAverage;
export 'chart_palette.dart' show ChartPalette, ChartTone;
export 'chart_scrub.dart' show ChartScrubMode, ScrubHaptics;
export 'column_chart.dart' show ColumnChart, ColumnSeries;
export 'dither.dart'
    show
        DitherMask,
        buildDitherMask,
        ditherCellAlpha,
        ditherCellSize,
        ditherThreshold;
export 'excess_strip.dart' show ExcessDot, ExcessStrip;
export 'line_charts.dart' show CurveChart, DitherAreaChart, MultiLineChart;
export 'sparkline.dart' show Sparkline;
