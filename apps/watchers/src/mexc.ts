#!/usr/bin/env node
import { Command } from "commander";
import { registerMexcCommands } from "./mexc/commands";

const program = new Command();
program
  .name("zephyr-watcher-mexc")
  .description("MEXC watcher CLI")
  .version("0.1.0");

registerMexcCommands(program);

program.parseAsync();
