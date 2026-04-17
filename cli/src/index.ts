#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("shipeasy").description("CLI for the ShipEasy experiment platform").version("1.0.0");

program
  .command("login")
  .description("Authenticate via device flow")
  .action(() => {
    console.log("TODO: device auth flow");
  });

program.parse(process.argv);
