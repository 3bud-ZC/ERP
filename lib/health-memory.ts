export function getMemoryHealth() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const heapUsagePercent = heapTotalMB > 0 ? (heapUsedMB / heapTotalMB) * 100 : 0;

  // V8 grows heapTotal lazily, so a tiny heap can show 90%+ usage while the
  // process is only using a few dozen MB. Treat absolute pressure as the signal.
  const status =
    heapUsedMB < 128 || heapUsagePercent < 85
      ? 'healthy'
      : heapUsedMB < 256
        ? 'degraded'
        : 'unhealthy';

  return {
    status,
    heapUsedMB,
    heapTotalMB,
    heapUsagePercent,
    message: `${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${heapUsagePercent.toFixed(1)}%)`,
  } as const;
}
