package dev.geldar.ledger.paper.spark;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.paper.spark.SparkReader.Point;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import me.lucko.spark.api.Spark;
import me.lucko.spark.api.SparkProvider;
import me.lucko.spark.api.gc.GarbageCollector;
import me.lucko.spark.api.statistic.StatisticWindow;
import me.lucko.spark.api.statistic.misc.DoubleAverageInfo;
import me.lucko.spark.api.statistic.types.DoubleStatistic;
import me.lucko.spark.api.statistic.types.GenericStatistic;

/**
 * The only class that names spark types. It is loaded only after the reader found spark's provider class. It reads
 * the summary statistics (tps, mspt, cpu, gc totals) and nothing else.
 */
final class SparkApiAdapter implements SparkReader.Api {
    static final String LIFETIME = "lifetime";

    @Override
    public List<Point> read() {
        Spark spark = SparkProvider.get();
        List<Point> out = new ArrayList<>();
        doubles(out, Names.Spark.TPS, spark.tps(), null, null);
        doubles(out, Names.Spark.CPU_RATIO, spark.cpuProcess(), AttrKeys.M_SCOPE, "process");
        doubles(out, Names.Spark.CPU_RATIO, spark.cpuSystem(), AttrKeys.M_SCOPE, "system");
        mspt(out, spark.mspt());
        for (var e : spark.gc().entrySet()) {
            GarbageCollector gc = e.getValue();
            if (gc != null && Double.isFinite(gc.avgTime())) {
                out.add(new Point(
                        Names.Spark.GC_MS,
                        new String[] {AttrKeys.M_GC, e.getKey(), AttrKeys.M_WINDOW, LIFETIME},
                        gc.avgTime()));
            }
        }
        return out;
    }

    private static <W extends Enum<W> & StatisticWindow> void doubles(
            List<Point> out, String metric, DoubleStatistic<W> stat, String extraKey, String extraValue) {
        for (W w : stat.getWindows()) {
            double v = stat.poll(w);
            if (!Double.isFinite(v)) {
                continue;
            }
            String[] attrs = extraKey == null
                    ? new String[] {AttrKeys.M_WINDOW, window(w)}
                    : new String[] {extraKey, extraValue, AttrKeys.M_WINDOW, window(w)};
            out.add(new Point(metric, attrs, v));
        }
    }

    private static <W extends Enum<W> & StatisticWindow> void mspt(
            List<Point> out, GenericStatistic<DoubleAverageInfo, W> stat) {
        for (W w : stat.getWindows()) {
            DoubleAverageInfo info = stat.poll(w);
            if (info == null) {
                continue;
            }
            stat(out, w, "mean", info.mean());
            stat(out, w, "p95", info.percentile95th());
            stat(out, w, "max", info.max());
        }
    }

    private static void stat(List<Point> out, Enum<?> w, String stat, double v) {
        if (Double.isFinite(v)) {
            out.add(new Point(
                    Names.Spark.MSPT_MS, new String[] {AttrKeys.M_WINDOW, window(w), AttrKeys.M_STAT, stat}, v));
        }
    }

    /** {@code SECONDS_10} becomes {@code 10s}, {@code MINUTES_15} becomes {@code 15m}. */
    static String window(Enum<?> w) {
        String[] p = w.name().toLowerCase(Locale.ROOT).split("_");
        return p.length == 2 ? p[1] + p[0].charAt(0) : w.name();
    }
}
