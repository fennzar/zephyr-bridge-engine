#!/usr/bin/env node
import { Command } from "commander";
import { registerEvmCommands } from "./evm/commands";

const program = new Command();
program
  .name("zephyr-watcher-evm")
  .description("EVM / Uniswap watcher CLI")
  .version("0.1.0");

registerEvmCommands(program);

program.parseAsync();
