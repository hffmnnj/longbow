import 'package:flutter/material.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';

/// A ticker symbol that opens its chart page. Minimum 48dp tall hit area while
/// the visible text stays inline. The web `Ticker`.
class TickerLink extends StatelessWidget {
  const TickerLink(this.symbol, {super.key, this.style});

  final String symbol;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Open $symbol chart',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(LbRadius.sm),
        onTap: () => AppNav.symbol(context, symbol),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget, minWidth: 40),
          child: Align(
            alignment: Alignment.centerLeft,
            widthFactor: 1,
            child: Text(symbol, style: style ?? LbText.number(context, size: 14, weight: FontWeight.w600, color: context.lb.foreground)),
          ),
        ),
      ),
    );
  }
}
