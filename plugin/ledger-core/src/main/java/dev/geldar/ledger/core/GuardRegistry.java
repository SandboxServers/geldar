package dev.geldar.ledger.core;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/** One {@link BudgetGuard} per collector id. {@link #reload} applies a new config snapshot to all of them. */
public final class GuardRegistry {
    private final Logger logger;
    private final Map<String, BudgetGuard> guards = new ConcurrentHashMap<>();

    public GuardRegistry(Logger logger) {
        this.logger = logger;
    }

    /** The guard of {@code id}, created on first use with the budgets and switch of {@code config}. */
    public BudgetGuard guard(String id, LedgerConfig config) {
        return guards.computeIfAbsent(id, k -> {
            BudgetGuard g = new BudgetGuard(k, logger, config.budgetAvgUs(k), config.budgetMaxUs(k));
            g.setConfigEnabled(config.collectorEnabled(k));
            return g;
        });
    }

    /**
     * Updates budgets of every guard. A tripped guard is re-enabled only when the config switch for it flips from
     * off to on (the operator turned it off, then on); an unchanged config never re-enables.
     */
    public void reload(LedgerConfig config) {
        for (BudgetGuard g : guards.values()) {
            String id = g.id();
            g.setBudgets(config.budgetAvgUs(id), config.budgetMaxUs(id));
            boolean now = config.collectorEnabled(id);
            boolean wasOn = g.configEnabled();
            g.setConfigEnabled(now);
            if (!wasOn && now) {
                g.reenable();
            }
        }
    }
}
