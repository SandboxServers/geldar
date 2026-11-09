package dev.geldar.core;

import java.util.ArrayDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** A bounded FIFO that drops the oldest element when full and counts the drops. */
public final class BoundedEventQueue<T> {
    private final ArrayDeque<T> items = new ArrayDeque<>();
    private final int capacity;
    private final AtomicLong dropped = new AtomicLong();

    public BoundedEventQueue(int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity must be at least 1");
        }
        this.capacity = capacity;
    }

    /** Adds an element; when the queue is full the oldest element is discarded. */
    public synchronized void offer(T item) {
        if (items.size() >= capacity) {
            items.pollFirst();
            dropped.incrementAndGet();
        }
        items.addLast(item);
        notifyAll();
    }

    /** Removes the oldest element, waiting up to the timeout; null when none arrived. */
    public synchronized T poll(long timeout, TimeUnit unit) throws InterruptedException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        while (items.isEmpty()) {
            long left = deadline - System.nanoTime();
            if (left <= 0) {
                return null;
            }
            TimeUnit.NANOSECONDS.timedWait(this, left);
        }
        return items.pollFirst();
    }

    public synchronized int size() {
        return items.size();
    }

    /** How many elements were discarded because the queue was full. */
    public long dropped() {
        return dropped.get();
    }
}