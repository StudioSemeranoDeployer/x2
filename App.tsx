import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, SimulationStats, ChartDataPoint, SimulationStatus, DistributionStrategy } from './types';
import { QueueVisualizer } from './components/QueueVisualizer';
import { StatsChart } from './components/StatsChart';
import { SmartContractViewer } from './components/SmartContractViewer';
import { analyzeRisk } from './services/geminiService';
import { Play, Pause, RefreshCw, AlertTriangle, ChevronRight, BarChart3, Bot, TrendingUp, Moon, FileCode, Dna, Settings, Users, ShieldCheck, Wallet, Skull, Flame, TrendingDown, Timer } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_RESERVE = 1000;
const FEE_PERCENT = 0.01; // 1%
const GUILLOTINE_INTERVAL = 60; // Ticks representing ~6 hours

// Internal Engine State Interface (Mutable)
interface EngineState {
  queue: Player[];
  historyCount: number;
  historySum: number;
  totalDeposited: number;
  protocolBalance: number;
  currentRound: number;
  chartData: ChartDataPoint[];
  tickCount: number; // For timers
}

const App: React.FC = () => {
  // --- UI State (Synced periodically) ---
  const [activeTab, setActiveTab] = useState<'simulation' | 'contract'>('simulation');
  const [multiplier, setMultiplier] = useState<number>(2.0);
  const [strategy, setStrategy] = useState<DistributionStrategy>(DistributionStrategy.STANDARD);
  
  // Strategy Toggles
  const [guillotineEnabled, setGuillotineEnabled] = useState<boolean>(false);
  const [dynamicDecayEnabled, setDynamicDecayEnabled] = useState<boolean>(false);
  const [winnersTaxEnabled, setWinnersTaxEnabled] = useState<boolean>(false);

  const [status, setStatus] = useState<SimulationStatus>(SimulationStatus.IDLE);
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [manualDepositAmount, setManualDepositAmount] = useState<number>(100);

  // Snapshot for Rendering
  const [uiSnapshot, setUiSnapshot] = useState<{
    queueSlice: Player[];
    stats: SimulationStats;
    chartData: ChartDataPoint[];
    headPlayer: Player | null;
  }>({
    queueSlice: [],
    stats: {
      totalDeposited: 0,
      totalPaidOut: 0,
      totalUsers: 0,
      usersPaidExit: 0,
      usersTrapped: 0,
      currentQueueLength: 0,
      currentRound: 1,
      strategy: DistributionStrategy.STANDARD,
      multiplier: 2.0,
      protocolBalance: INITIAL_RESERVE,
      guillotineEnabled: false,
      dynamicDecayEnabled: false,
      winnersTaxEnabled: false
    },
    chartData: [],
    headPlayer: null
  });

  // --- Engine (Mutable Ref - No Re-renders) ---
  const engine = useRef<EngineState>({
    queue: [],
    historyCount: 0,
    historySum: 0,
    totalDeposited: 0,
    protocolBalance: INITIAL_RESERVE,
    currentRound: 1,
    chartData: [],
    tickCount: 0
  });

  // Logic: The Guillotine
  const triggerGuillotine = () => {
    const state = engine.current;
    if (state.queue.length < 5) return; // Need some crowd

    // 1. Find the biggest liabilities (Remaining Target)
    const candidates = [...state.queue]
      .filter(p => !p.slashed) 
      .sort((a, b) => (b.target - b.collected) - (a.target - a.collected))
      .slice(0, 30); // Top 30 Whales

    if (candidates.length === 0) return;

    // 2. Pick 10 Random victims
    const victims: Player[] = [];
    const pool = [...candidates];
    
    for (let i = 0; i < 10; i++) {
       if (pool.length === 0) break;
       const randIndex = Math.floor(Math.random() * pool.length);
       victims.push(pool[randIndex]);
       pool.splice(randIndex, 1);
    }

    // 3. Slash them by 20%
    victims.forEach(v => {
      const originalTarget = v.target;
      v.target = originalTarget * 0.80; // 20% haircut
      v.slashed = true;
    });
  };

  // Helper: Process a single deposit logic
  const processDeposit = (amount: number, isSystem: boolean = false) => {
    const state = engine.current;
    state.tickCount++;

    // GUILLOTINE CHECK
    if (guillotineEnabled && state.tickCount % GUILLOTINE_INTERVAL === 0) {
      triggerGuillotine();
    }
    
    // 1. Take Fee (if not system)
    let netAmount = amount;
    if (!isSystem) {
      const fee = amount * FEE_PERCENT;
      const actualFee = Math.max(1, fee); // Min $1 fee
      netAmount = amount - actualFee;
      state.protocolBalance += actualFee;
    }

    state.totalDeposited += amount;

    // 2. Define Distribution Pools
    let headPool = netAmount;
    let yieldPool = 0;

    if (strategy === DistributionStrategy.COMMUNITY_YIELD) {
      yieldPool = netAmount * 0.20; // 20%
      headPool = netAmount * 0.80;  // 80%
    }

    // 3. Dynamic Decay Calculation
    let effectiveMultiplier = multiplier;
    if (dynamicDecayEnabled && !isSystem) {
      // Decay: Lose 0.05x for every 10 people in queue
      const decayFactor = Math.floor(state.queue.length / 10) * 0.05;
      effectiveMultiplier = Math.max(1.1, multiplier - decayFactor);
    }

    // 4. Create Player
    const newPlayer: Player = {
      id: isSystem ? 'PROTOCOL_SEED' : uuidv4(),
      deposit: amount,
      target: amount * effectiveMultiplier,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false
    };

    // 5. Distribute Yield (Drip)
    if (yieldPool > 0 && state.queue.length > 0) {
      const yieldShare = yieldPool / state.queue.length;
      for (const p of state.queue) {
        p.collected += yieldShare;
      }
    }

    // 6. Distribute to Head (FIFO)
    let remaining = headPool;
    for (const p of state.queue) {
      if (remaining <= 0) break;
      const needed = p.target - p.collected;
      if (needed <= 0) continue; 

      if (remaining >= needed) {
        p.collected += needed; 
        remaining -= needed;
      } else {
        p.collected += remaining;
        remaining = 0;
      }
    }

    // 7. Add new player
    state.queue.push(newPlayer);

    // 8. Cleanup Sweep (Remove fully paid)
    const nextQueue: Player[] = [];
    for (const p of state.queue) {
      if (p.collected >= p.target - 0.01) {
        p.collected = p.target; // Visual clean
        
        // WINNERS TAX LOGIC
        // If enabled and exit time is "fast" (simulated as < 10 seconds since entry)
        if (winnersTaxEnabled && !isSystem && (Date.now() - p.timestamp < 10000)) {
           const profit = p.collected - p.deposit;
           if (profit > 0) {
             const tax = profit * 0.20; // 20% of profit
             state.protocolBalance += tax;
             // Note: We don't reduce 'collected' on the player object to keep history accurate of what was "generated",
             // but effectively the protocol absorbed that value. 
           }
        }

        state.historyCount++;
        state.historySum += p.target;
      } else {
        nextQueue.push(p);
      }
    }
    state.queue = nextQueue;

    // 9. Update Chart Data
    const liability = state.queue.reduce((acc, p) => acc + (p.target - p.collected), 0);
    state.chartData.push({
      round: state.totalDeposited,
      usersTrapped: state.queue.length,
      requiredNewLiquidity: liability
    });
    if (state.chartData.length > 100) state.chartData.shift();
  };

  // --- Reset Logic ---
  const handleMidnightReset = () => {
    const state = engine.current;
    
    // 1. REFUND PHASE
    let surplus = Math.max(0, state.protocolBalance - INITIAL_RESERVE);
    if (surplus > 0) {
      for (const p of state.queue) {
        if (surplus <= 0) break;
        const remainingPrincipal = Math.max(0, p.deposit - p.collected);
        if (remainingPrincipal > 0) {
           const pay = Math.min(surplus, remainingPrincipal);
           p.collected += pay;
           surplus -= pay;
        }
      }
      state.protocolBalance = INITIAL_RESERVE + surplus; 
    }

    // 2. WIPE
    state.queue = [];
    
    // 3. RESTART
    state.currentRound++;
    
    // 4. PROTOCOL SEED
    if (state.protocolBalance >= 100) {
       state.protocolBalance -= 100;
       processDeposit(100, true);
    }
  };

  const handleFullReset = () => {
    setStatus(SimulationStatus.IDLE);
    engine.current = {
      queue: [],
      historyCount: 0,
      historySum: 0,
      totalDeposited: 0,
      protocolBalance: INITIAL_RESERVE,
      currentRound: 1,
      chartData: [],
      tickCount: 0
    };
    syncUI();
  };

  // --- Sync Loop (Engine -> UI) ---
  const syncUI = useCallback(() => {
    const state = engine.current;
    
    setUiSnapshot({
      queueSlice: state.queue.slice(0, 8),
      stats: {
        totalDeposited: state.totalDeposited,
        totalPaidOut: state.historySum,
        totalUsers: state.historyCount + state.queue.length,
        usersPaidExit: state.historyCount,
        usersTrapped: state.queue.length,
        currentQueueLength: state.queue.length,
        currentRound: state.currentRound,
        strategy,
        multiplier,
        protocolBalance: state.protocolBalance,
        guillotineEnabled,
        dynamicDecayEnabled,
        winnersTaxEnabled
      },
      chartData: [...state.chartData], 
      headPlayer: state.queue[0] || null
    });
  }, [strategy, multiplier, guillotineEnabled, dynamicDecayEnabled, winnersTaxEnabled]);

  // --- Timers ---
  useEffect(() => {
    const timer = setInterval(syncUI, 200); 
    return () => clearInterval(timer);
  }, [syncUI]);

  useEffect(() => {
    if (status !== SimulationStatus.RUNNING) return;
    
    const timer = setInterval(() => {
      const amount = Math.floor(Math.random() * 990) + 10; 
      processDeposit(amount);
    }, 100); 

    return () => clearInterval(timer);
  }, [status, strategy, multiplier, guillotineEnabled, dynamicDecayEnabled, winnersTaxEnabled]);

  const handleManualDeposit = () => {
    processDeposit(manualDepositAmount);
    syncUI();
  };

  const handleAnalyze = async () => {
    if (!process.env.API_KEY) {
      setAnalysis("Error: API Key not found.");
      return;
    }
    setIsAnalyzing(true);
    const concept = `
      Protocol with ${multiplier}x Base Multiplier.
      Strategy: ${strategy}.
      Options: 
      - Guillotine: ${guillotineEnabled}
      - Dynamic Decay: ${dynamicDecayEnabled} (Lowers ROI for late entrants)
      - Winners Tax: ${winnersTaxEnabled} (20% fee on fast profits > Vault)
      Reserve: ${uiSnapshot.stats.protocolBalance.toFixed(2)} available.
      Midnight Reset: Active.
    `;
    const result = await analyzeRisk(uiSnapshot.stats, concept);
    setAnalysis(result);
    setIsAnalyzing(false);
  };

  const { stats, queueSlice, chartData, headPlayer } = uiSnapshot;

  const totalLiability = uiSnapshot.stats.usersTrapped > 0 
     ? engine.current.queue.reduce((acc, p) => acc + (p.target - p.collected), 0)
     : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        
        {/* Top Header */}
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <Dna className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">
                x2gether <span className="text-emerald-500">Protocol</span>
              </h1>
              <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                <span className="bg-slate-800 px-2 py-0.5 rounded text-xs font-mono text-slate-300">v3.0-RC</span>
                <span>•</span>
                <span>Algorithmic Simulation</span>
              </div>
            </div>
          </div>

          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setActiveTab('simulation')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'simulation' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Simulation Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('contract')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'contract' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <FileCode className="w-4 h-4" /> Smart Contract
            </button>
          </div>
        </header>

        {activeTab === 'simulation' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Controls & Protocol Wallet */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Protocol Vault Card */}
              <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-all"></div>
                 
                 <div className="flex items-center justify-between mb-6 relative z-10">
                   <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                     <ShieldCheck className="w-4 h-4 text-emerald-500" /> Protocol Vault
                   </h2>
                   <div className="text-[10px] bg-emerald-950/50 text-emerald-400 px-2 py-1 rounded border border-emerald-900/50">
                     Verifiable On-Chain
                   </div>
                 </div>

                 <div className="relative z-10">
                   <div className="text-4xl font-mono font-bold text-white mb-1">
                     ${stats.protocolBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   </div>
                   <div className="text-xs text-slate-500 mb-6 flex justify-between">
                      <span>Reserve Floor: $1,000.00</span>
                      <span className="text-emerald-400">
                         {stats.protocolBalance > 1000 ? `+$${(stats.protocolBalance - 1000).toFixed(2)} Surplus` : 'Base Level'}
                      </span>
                   </div>

                   <button 
                      onClick={handleMidnightReset}
                      className="w-full bg-indigo-600/90 hover:bg-indigo-500 text-white p-3 rounded-xl font-medium transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 group/btn border border-indigo-500/50"
                    >
                      <Moon className="w-4 h-4 group-hover/btn:-rotate-12 transition-transform" /> 
                      Execute Midnight Reset
                   </button>
                   <p className="text-[10px] text-center text-slate-500 mt-2">
                     Surplus funds used to refund queue before reset.
                   </p>
                 </div>
              </div>

              {/* Control Panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Parameters
                </h2>
                
                <div className="space-y-4">
                  {/* Multiplier */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-2">
                      <span>Base Multiplier</span>
                      <span className="text-white font-mono">{multiplier}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="1.1" 
                      max="3.0" 
                      step="0.1"
                      value={multiplier}
                      onChange={(e) => {
                        setMultiplier(parseFloat(e.target.value));
                        handleFullReset();
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                    />
                  </div>

                  {/* Strategy */}
                  <div className="space-y-2">
                    <span className="text-xs text-slate-400">Distribution Strategy</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => { setStrategy(DistributionStrategy.STANDARD); handleFullReset(); }}
                        className={`p-2.5 rounded-xl border text-xs font-medium transition-all text-left relative overflow-hidden ${
                          strategy === DistributionStrategy.STANDARD 
                          ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-400' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        <span className="relative z-10 font-bold block">FIFO Standard</span>
                        <span className="relative z-10 text-[10px] opacity-80">100% to Head</span>
                      </button>
                      <button 
                        onClick={() => { setStrategy(DistributionStrategy.COMMUNITY_YIELD); handleFullReset(); }}
                        className={`p-2.5 rounded-xl border text-xs font-medium transition-all text-left relative overflow-hidden ${
                          strategy === DistributionStrategy.COMMUNITY_YIELD 
                          ? 'bg-purple-950/30 border-purple-500/50 text-purple-400' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        <span className="relative z-10 font-bold block">Community Yield</span>
                        <span className="relative z-10 text-[10px] opacity-80">20% shared yield</span>
                      </button>
                    </div>
                  </div>

                  <hr className="border-slate-800" />

                  {/* MECHANICS TOGGLES */}
                  <div className="space-y-3">
                    {/* Guillotine Toggle */}
                    <div className={`p-3 rounded-xl border transition-all ${
                       guillotineEnabled 
                       ? 'bg-red-950/20 border-red-500/40 shadow-sm' 
                       : 'bg-slate-950 border-slate-800 opacity-60'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                         <span className={`text-xs font-bold flex items-center gap-2 ${guillotineEnabled ? 'text-red-400' : 'text-slate-500'}`}>
                            <Skull className="w-3.5 h-3.5" /> La Ghigliottina
                         </span>
                         <button 
                           onClick={() => setGuillotineEnabled(!guillotineEnabled)}
                           className={`w-8 h-4 rounded-full relative transition-colors ${guillotineEnabled ? 'bg-red-600' : 'bg-slate-700'}`}
                         >
                           <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${guillotineEnabled ? 'left-4.5' : 'left-0.5'}`} style={{left: guillotineEnabled ? '18px' : '2px'}}></div>
                         </button>
                      </div>
                      <p className="text-[9px] text-slate-500">Slashes 20% off whales periodically.</p>
                    </div>

                    {/* Dynamic Decay Toggle */}
                    <div className={`p-3 rounded-xl border transition-all ${
                       dynamicDecayEnabled 
                       ? 'bg-orange-950/20 border-orange-500/40 shadow-sm' 
                       : 'bg-slate-950 border-slate-800 opacity-60'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                         <span className={`text-xs font-bold flex items-center gap-2 ${dynamicDecayEnabled ? 'text-orange-400' : 'text-slate-500'}`}>
                            <TrendingDown className="w-3.5 h-3.5" /> Dynamic Decay
                         </span>
                         <button 
                           onClick={() => setDynamicDecayEnabled(!dynamicDecayEnabled)}
                           className={`w-8 h-4 rounded-full relative transition-colors ${dynamicDecayEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}
                         >
                           <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: dynamicDecayEnabled ? '18px' : '2px'}}></div>
                         </button>
                      </div>
                      <p className="text-[9px] text-slate-500">Multiplier drops as queue grows.</p>
                    </div>

                    {/* Winners Tax Toggle */}
                    <div className={`p-3 rounded-xl border transition-all ${
                       winnersTaxEnabled 
                       ? 'bg-blue-950/20 border-blue-500/40 shadow-sm' 
                       : 'bg-slate-950 border-slate-800 opacity-60'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                         <span className={`text-xs font-bold flex items-center gap-2 ${winnersTaxEnabled ? 'text-blue-400' : 'text-slate-500'}`}>
                            <Timer className="w-3.5 h-3.5" /> Winners Tax
                         </span>
                         <button 
                           onClick={() => setWinnersTaxEnabled(!winnersTaxEnabled)}
                           className={`w-8 h-4 rounded-full relative transition-colors ${winnersTaxEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                         >
                           <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: winnersTaxEnabled ? '18px' : '2px'}}></div>
                         </button>
                      </div>
                      <p className="text-[9px] text-slate-500">20% profit tax on 1h fast-exits.</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-slate-800">
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={handleManualDeposit}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-white p-2.5 rounded-lg text-sm font-medium transition-colors border border-slate-700"
                      >
                         + Dep.
                      </button>
                      <button 
                        onClick={() => setStatus(status === SimulationStatus.RUNNING ? SimulationStatus.PAUSED : SimulationStatus.RUNNING)}
                        className={`flex-1 p-2.5 rounded-lg text-sm font-medium transition-all border flex items-center justify-center gap-2 ${
                          status === SimulationStatus.RUNNING 
                          ? 'bg-amber-900/20 border-amber-500/50 text-amber-500 hover:bg-amber-900/30' 
                          : 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                        }`}
                      >
                        {status === SimulationStatus.RUNNING ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Auto</>}
                      </button>
                    </div>
                    
                    <button 
                      onClick={handleFullReset}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> Reset Everything
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Middle: Stats & Queue */}
            <div className="lg:col-span-4 space-y-6">
               {/* Live Stats */}
               <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                 <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-500" /> Network Status
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${status === SimulationStatus.RUNNING ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
                      <span className="text-xs text-slate-500 font-mono">
                        {status === SimulationStatus.RUNNING ? 'LIVE' : 'PAUSED'}
                      </span>
                    </div>
                 </div>

                 {/* Head Status */}
                 <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 mb-4 relative overflow-hidden">
                    {headPlayer ? (
                      <>
                        <div className="flex justify-between items-start mb-2 relative z-10">
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Current Priority</div>
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                               {headPlayer.id === 'PROTOCOL_SEED' ? 'PROTOCOL SEED' : `User ${headPlayer.id.slice(0,6)}...`}
                               {headPlayer.slashed && <Skull className="w-3 h-3 text-red-500" />}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Payout Progress</div>
                            <div className="text-sm font-mono font-bold text-emerald-400">
                              ${headPlayer.collected.toFixed(0)} <span className="text-slate-600">/</span> ${headPlayer.target.toFixed(0)}
                            </div>
                          </div>
                        </div>
                        
                        <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
                          <div 
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 ease-out"
                            style={{ width: `${(headPlayer.collected / headPlayer.target) * 100}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-right text-slate-500">
                          {((headPlayer.collected / headPlayer.target) * 100).toFixed(1)}% Completed
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-4 text-slate-500 text-xs italic">
                        Waiting for deposits...
                      </div>
                    )}
                 </div>

                 {/* Grid Stats */}
                 <div className="grid grid-cols-2 gap-3">
                   <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                     <div className="text-[10px] text-slate-500 uppercase mb-1">Queue Size</div>
                     <div className="text-2xl font-mono font-bold text-white">{stats.usersTrapped.toLocaleString()}</div>
                     <div className="text-[10px] text-slate-600">Active participants</div>
                   </div>
                   <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                     <div className="text-[10px] text-slate-500 uppercase mb-1">Total Exited</div>
                     <div className="text-2xl font-mono font-bold text-white">{stats.usersPaidExit.toLocaleString()}</div>
                     <div className="text-[10px] text-slate-600">Completed cycle</div>
                   </div>
                 </div>

                 <div className="mt-4 pt-4 border-t border-slate-800">
                   <div className="flex justify-between items-center text-xs">
                     <span className="text-red-400 flex items-center gap-1.5">
                       <AlertTriangle className="w-3 h-3" /> System Debt
                     </span>
                     <span className="font-mono font-bold text-red-400">
                       ${totalLiability.toLocaleString()}
                     </span>
                   </div>
                 </div>
               </div>

               {/* Queue Visual */}
               <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 h-[400px] flex flex-col">
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-500" /> Queue Viz
                  </h2>
                  <div className="flex-grow overflow-hidden">
                    <QueueVisualizer queue={queueSlice} maxDisplay={7} />
                  </div>
               </div>
            </div>

            {/* Right: Charts & Audit */}
            <div className="lg:col-span-4 space-y-6">
              
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" /> Growth Curve
                </h2>
                <StatsChart data={chartData} />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col h-[400px]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-500" /> AI Auditor
                  </h2>
                  <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || stats.totalUsers === 0}
                    className="text-[10px] bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Run Audit'}
                  </button>
                </div>
                
                <div className="flex-grow bg-slate-950/50 rounded-xl p-4 border border-slate-800 text-sm text-slate-300 overflow-y-auto custom-scrollbar">
                  {analysis ? (
                    <div className="prose prose-invert prose-sm">
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">{analysis}</pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                      <Bot className="w-10 h-10 opacity-20" />
                      <p className="text-center text-xs max-w-[200px]">
                        Start the simulation to generate data, then ask the AI to audit the protocol's sustainability.
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        ) : (
          <SmartContractViewer />
        )}
      </div>
    </div>
  );
};

export default App;