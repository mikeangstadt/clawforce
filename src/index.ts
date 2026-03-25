#!/usr/bin/env node

import { createCli } from './cli/commands.js';

const program = createCli();
program.parse();
