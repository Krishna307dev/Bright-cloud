# Error Handling

## Error classes

### USB errors

-   device removed
-   permission denied
-   unsupported device
-   host mode unavailable
-   provider unavailable

### File errors

-   file disappeared
-   permission denied
-   read failure
-   changed while hashing
-   malformed provider metadata

### Hash errors

-   stream closed
-   I/O error
-   cancellation

### Cloud errors

-   authentication expired
-   network timeout
-   quota
-   permission/security rules
-   server error
-   object conflict

### Local database errors

-   transaction conflict
-   migration error
-   disk full
-   corruption

## Retry policy

Retry only transient failures.

Use exponential backoff with jitter.

Do not retry permanent permission failures forever.

## Logging

Logs should be structured and privacy-aware.

Do not log:

-   file contents
-   authentication tokens
-   service-account secrets
-   full private download tokens

Useful fields:

``` text
jobId
sourceId
fileId
relativePath (only if acceptable for private local logs)
state
errorClass
attempt
duration
bytes
```

## Recovery

On worker restart:

1.  Load incomplete job.
2.  Validate source availability.
3.  Validate current local state.
4.  Resume or safely restart the current stage.
5.  Never assume an in-memory flag survived process death.
