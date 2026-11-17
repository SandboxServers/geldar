package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;

/** The three ports a collector gets, as one value. */
public record CollectorCtx(Ledger ledger, HostInfo host, HostScheduler scheduler) implements CollectorContext {}