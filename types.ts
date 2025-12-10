
export interface Player {
  id: string;
  deposit: number;
  target: number; // The x2 amount
  collected: number;
  entryRound: number;
  timestamp: number;
  slashed?: boolean; // True if hit by Guillotine
  multiplier: number; // The specific multiplier at entry
}

export enum DistributionStrategy {
  STANDARD = 'STANDARD', // 100% to Head
  COMMUNITY_YIELD = 'COMMUNITY_YIELD', // 80% to Head, 20% split among all in queue
}

export interface SimulationConfig {
  feePercent: number;        // Entry Fee (0-0.10)
  guillotineStrength: number; // How much to slash (0.05-0.50)
  winnersTaxRate: number;    // Tax on fast exits (0.05-0.50)
  hourlyDripRate: number;    // % of Vault to drip (0.01-1.0)
}

export interface SimulationStats {
  totalDeposited: number;
  totalPaidOut: number;
  totalUsers: number;
  usersPaidExit: number;
  usersTrapped: number;
  currentQueueLength: number;
  currentRound: number;
  strategy: DistributionStrategy;
  multiplier: number;
  protocolBalance: number; // Tracks Reserve + Fees + Taxes
  guillotineEnabled: boolean;
  dynamicDecayEnabled: boolean;
  winnersTaxEnabled: boolean;
  config: SimulationConfig; // Added customizable config
}

export interface ChartDataPoint {
  round: number;
  usersTrapped: number;
  requiredNewLiquidity: number;
}

export enum SimulationStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
}
