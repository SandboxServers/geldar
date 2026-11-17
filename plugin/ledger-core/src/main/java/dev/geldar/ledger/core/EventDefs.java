package dev.geldar.ledger.core;

import java.util.Arrays;

/** Registered event definitions of one queue, indexed by the id handed to the producer. Startup writes, any thread reads. */
final class EventDefs {
    /** One registered event. {@code fields[i]} names ring slot i (3 longs, then 3 strings); null skips the slot. */
    static final class Def {
        final String name;
        final Severity severity;
        final String[] fields;
        final TokenBucket bucket;

        Def(String name, Severity severity, String[] fields, TokenBucket bucket) {
            this.name = name;
            this.severity = severity;
            this.fields = fields;
            this.bucket = bucket;
        }
    }

    private volatile Def[] defs = new Def[0];

    synchronized int add(Def def) {
        Def[] next = Arrays.copyOf(defs, defs.length + 1);
        next[defs.length] = def;
        defs = next;
        return defs.length - 1;
    }

    /** The definition for {@code id}, or null for an unknown id. */
    Def get(int id) {
        Def[] d = defs;
        return id >= 0 && id < d.length ? d[id] : null;
    }
}
