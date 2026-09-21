# First run failure retained

The first standalone invocation exited before creating a report because generatePublicSite imports contentPlan, which requires PUBLIC_SITE_BASE_URL during module initialization. The harness now sets its fixed synthetic configuration and removes API_KEY environment entries before dynamically importing the generator inside the temporary working directory. r1.log is retained; r2/r3 produced measured NO_GO reports, exit 1, not harness errors. Source code under src/ was not modified.
