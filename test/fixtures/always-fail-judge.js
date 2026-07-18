#!/usr/bin/env node
process.stderr.write("rate limit exceeded: quota exhausted\n");
process.exitCode = 1;
