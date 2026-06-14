export const RECOVERY_LIMITS = {
  bottom: 520,
  left: 520,
  right: 700
};

export function getRideRecovery(telemetry, rider, bounds, limits = RECOVERY_LIMITS) {
  if (!rider) {
    return null;
  }

  if (telemetry?.status === 'crashed') {
    return {
      reason: 'crashed',
      status: 'crashed',
      detail: {
        frame: telemetry.frame,
        x: Math.round(rider.position.x),
        y: Math.round(rider.position.y)
      }
    };
  }

  if (
    rider.position.y > bounds.maxY + limits.bottom ||
    rider.position.x < bounds.minX - limits.left ||
    rider.position.x > bounds.maxX + limits.right
  ) {
    return {
      reason: 'out-of-bounds',
      status: 'rinse',
      detail: {
        x: Math.round(rider.position.x),
        y: Math.round(rider.position.y)
      }
    };
  }

  return null;
}
