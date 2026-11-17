package dev.geldar.ledger.core;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.Meter;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * A {@link Meter} built on dynamic proxies that remembers which instrument kind each registration builds and lets a
 * test fire the observable callbacks. The OpenTelemetry API has no in-memory reader, and the SDK is not on this
 * module's classpath.
 */
final class RecordingMeter {
    /** One data point an observable callback reported. */
    record Point(Attributes attrs, Number value) {}

    /** One instrument: the Meter method that started it ({@code counterBuilder}, {@code gaugeBuilder}, ...). */
    static final class Instrument {
        final String kind;
        final String name;
        boolean longs;
        boolean observable;
        Consumer<Object> callback;

        Instrument(String kind, String name) {
            this.kind = kind;
            this.name = name;
            this.longs = !kind.equals("gaugeBuilder") && !kind.equals("histogramBuilder");
        }

        /** Runs the observable callback once, as the exporter would, and returns what it reported. */
        List<Point> fire() {
            List<Point> points = new ArrayList<>();
            Class<?> type = longs
                    ? io.opentelemetry.api.metrics.ObservableLongMeasurement.class
                    : io.opentelemetry.api.metrics.ObservableDoubleMeasurement.class;
            Object measurement = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (p, m, a) -> {
                if (m.getName().equals("record")) {
                    points.add(new Point(a.length > 1 ? (Attributes) a[1] : Attributes.empty(), (Number) a[0]));
                }
                return null;
            });
            callback.accept(measurement);
            return points;
        }
    }

    final List<Instrument> instruments = new ArrayList<>();
    final Meter meter;

    RecordingMeter() {
        meter = (Meter) proxy(Meter.class, (p, m, a) -> {
            String n = m.getName();
            if (n.endsWith("Builder") && a != null && a.length == 1 && a[0] instanceof String name) {
                Instrument i = new Instrument(n, name);
                instruments.add(i);
                return proxy(m.getReturnType(), builder(i));
            }
            return objectMethod(p, m, a);
        });
    }

    /** Instruments registered under a name, in order. */
    List<Instrument> named(String name) {
        return instruments.stream().filter(i -> i.name.equals(name)).toList();
    }

    @SuppressWarnings("unchecked")
    private static InvocationHandler builder(Instrument i) {
        return (p, m, a) -> {
            switch (m.getName()) {
                case "ofLongs" -> i.longs = true;
                case "ofDoubles" -> i.longs = false;
                case "buildWithCallback" -> {
                    i.observable = true;
                    i.callback = (Consumer<Object>) a[0];
                }
                default -> {}
            }
            Class<?> r = m.getReturnType();
            return r.isInterface() ? proxy(r, builder(i)) : objectMethod(p, m, a);
        };
    }

    private static Object proxy(Class<?> type, InvocationHandler h) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, h);
    }

    private static Object objectMethod(Object p, Method m, Object[] a) {
        return switch (m.getName()) {
            case "hashCode" -> System.identityHashCode(p);
            case "equals" -> p == a[0];
            case "toString" -> "RecordingMeter";
            default -> null;
        };
    }
}
