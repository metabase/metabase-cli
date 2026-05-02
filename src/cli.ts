#!/usr/bin/env node
import { runMain } from "citty";

import main from "./main";
import { showUsage } from "./output/help";

runMain(main, { showUsage });
