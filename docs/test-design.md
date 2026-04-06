# Feature Design: Adaptive Rate Limiter

**Status:** Draft
**Author:** Human

## Overview

The Adaptive Rate Limiter is a middleware component that dynamically adjusts request rate limits based on real-time server load metrics. Unlike static rate limiters that use fixed thresholds, this system monitors CPU utilization, memory pressure, and response latency percentiles to calculate an optimal rate limit that maximizes throughput without degrading response quality.

## Motivation

Static rate limiters are configured once and rarely updated. During off-peak hours they leave capacity unused, and during traffic spikes they either let too much through (causing degradation) or reject too aggressively (losing legitimate requests). An adaptive system solves both problems.

## Proposed Design

### Core Components

1. **MetricsCollector** — Polls system metrics (CPU, memory, p99 latency) every 5 seconds and maintains a rolling 60-second window.

2. **RateCalculator** — Takes the metrics window and computes a target rate using a PID controller. The proportional term reacts to current load, the integral term corrects for sustained drift, and the derivative term dampens oscillation.

3. **TokenBucket** — Standard token bucket implementation whose refill rate is dynamically set by the RateCalculator. Tokens are per-client (keyed by API key or IP).

4. **CircuitBreaker** — If p99 latency exceeds 2x the baseline for 30+ seconds, the circuit opens and drops the rate limit to 10% of normal. It half-opens after 15 seconds, testing with a small traffic sample before fully closing.

### Configuration

```yaml
adaptive_rate_limiter:
  metrics_interval_ms: 5000
  window_size_seconds: 60
  pid:
    kp: 0.6
    ki: 0.1
    kd: 0.3
  circuit_breaker:
    latency_threshold_multiplier: 2.0
    open_duration_seconds: 30
    half_open_sample_percent: 5
  min_rate: 10
  max_rate: 10000
```

### Open Questions

- Should the PID coefficients be auto-tuned, or is manual configuration sufficient for v1?
- How do we handle multi-region deployments where each region has different baselines?
- Should rate limit changes be propagated to clients via response headers so they can back off proactively?

## Rollout Plan

1. Deploy in shadow mode (observe, don't enforce) for 1 week
2. Enable in enforce mode for internal traffic only
3. Gradual rollout to 10% → 50% → 100% of external traffic
4. Remove static rate limiter fallback after 30 days of stable operation
