/**
 * @license
 * Copyright (C) 2020 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {AttemptDetail, createAttemptMap} from './checks-util';
import {assertIsDefined} from '../../utils/common-util';
import {select} from '../../utils/observable-util';
import {Finalizable} from '../registry';
import {
  BehaviorSubject,
  combineLatest,
  from,
  Observable,
  of,
  Subject,
  Subscription,
  timer,
} from 'rxjs';
import {
  catchError,
  filter,
  switchMap,
  takeUntil,
  takeWhile,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import {
  Action,
  CheckResult as CheckResultApi,
  CheckRun as CheckRunApi,
  Link,
  ChangeData,
  ChecksApiConfig,
  ChecksProvider,
  FetchResponse,
  ResponseCode,
} from '../../api/checks';
import {change$, changeNum$, latestPatchNum$} from '../change/change-model';
import {ChangeInfo, NumericChangeId, PatchSetNumber} from '../../types/common';
import {getCurrentRevision} from '../../utils/change-util';
import {getShaByPatchNum} from '../../utils/patch-set-util';
import {ReportingService} from '../gr-reporting/gr-reporting';
import {routerPatchNum$} from '../router/router-model';
import {Execution} from '../../constants/reporting';
import {fireAlert, fireEvent} from '../../utils/event-util';

/**
 * The checks model maintains the state of checks for two patchsets: the latest
 * and (if different) also for the one selected in the checks tab. So we need
 * the distinction in a lot of places for checks about whether the code affects
 * the checks data of the LATEST or the SELECTED patchset.
 */
export enum ChecksPatchset {
  LATEST = 'LATEST',
  SELECTED = 'SELECTED',
}

export interface CheckResult extends CheckResultApi {
  /**
   * Internally we want to uniquely identify a run with an id, for example when
   * efficiently re-rendering lists of runs in the UI.
   */
  internalResultId: string;
}

export interface CheckRun extends CheckRunApi {
  /**
   * For convenience we attach the name of the plugin to each run.
   */
  pluginName: string;
  /**
   * Internally we want to uniquely identify a result with an id, for example
   * when efficiently re-rendering lists of results in the UI.
   */
  internalRunId: string;
  /**
   * Is this run attempt the latest attempt for the check, i.e. does it have
   * the highest attempt number among all checks with the same name?
   */
  isLatestAttempt: boolean;
  /**
   * Is this the only attempt for the check, i.e. we don't have data for other
   * attempts?
   */
  isSingleAttempt: boolean;
  /**
   * List of all attempts for the same check, ordered by attempt number.
   */
  attemptDetails: AttemptDetail[];
  results?: CheckResult[];
}

// This is a convenience type for working with results, because when working
// with a bunch of results you will typically also want to know about the run
// properties. So you can just combine them with {...run, ...result}.
export type RunResult = CheckRun & CheckResult;

export interface ChecksProviderState {
  pluginName: string;
  loading: boolean;
  /**
   * Allows to distinguish whether loading:true is the *first* time of loading
   * something for this provider. Or just a subsequent background update.
   * Note that this is initially true even before loading is being set to true,
   * so you may want to check loading && firstTimeLoad.
   */
  firstTimeLoad: boolean;
  /** Presence of errorMessage implicitly means that the provider is in ERROR state. */
  errorMessage?: string;
  /** Presence of loginCallback implicitly means that the provider is in NOT_LOGGED_IN state. */
  loginCallback?: () => void;
  runs: CheckRun[];
  actions: Action[];
  links: Link[];
}

interface ChecksState {
  /**
   * This is the patchset number selected by the user. The *latest* patchset
   * can be picked up from the change model.
   */
  patchsetNumberSelected?: PatchSetNumber;
  /** Checks data for the latest patchset. */
  pluginStateLatest: {
    [name: string]: ChecksProviderState;
  };
  /**
   * Checks data for the selected patchset. Note that `checksSelected$` below
   * falls back to the data for the latest patchset, if no patchset is selected.
   */
  pluginStateSelected: {
    [name: string]: ChecksProviderState;
  };
}

export interface ErrorMessages {
  /* Maps plugin name to error message. */
  [name: string]: string;
}

export class ChecksModel implements Finalizable {
  private readonly providers: {[name: string]: ChecksProvider} = {};

  private readonly reloadSubjects: {[name: string]: Subject<void>} = {};

  private checkToPluginMap = new Map<string, string>();

  private changeNum?: NumericChangeId;

  private latestPatchNum?: PatchSetNumber;

  private readonly documentVisibilityChange$ = new BehaviorSubject(undefined);

  private readonly reloadListener: () => void;

  private readonly visibilityChangeListener: () => void;

  private subscriptions: Subscription[] = [];

  private readonly privateState$ = new BehaviorSubject<ChecksState>({
    pluginStateLatest: {},
    pluginStateSelected: {},
  });

  public checksState$: Observable<ChecksState> =
    this.privateState$.asObservable();

  public checksSelectedPatchsetNumber$ = select(
    this.checksState$,
    state => state.patchsetNumberSelected
  );

  public checksLatest$ = select(
    this.checksState$,
    state => state.pluginStateLatest
  );

  public checksSelected$ = select(this.checksState$, state =>
    state.patchsetNumberSelected
      ? state.pluginStateSelected
      : state.pluginStateLatest
  );

  public aPluginHasRegistered$ = select(
    this.checksLatest$,
    state => Object.keys(state).length > 0
  );

  public someProvidersAreLoadingFirstTime$ = select(this.checksLatest$, state =>
    Object.values(state).some(
      provider => provider.loading && provider.firstTimeLoad
    )
  );

  public someProvidersAreLoadingLatest$ = select(this.checksLatest$, state =>
    Object.values(state).some(providerState => providerState.loading)
  );

  public someProvidersAreLoadingSelected$ = select(
    this.checksSelected$,
    state => Object.values(state).some(providerState => providerState.loading)
  );

  public errorMessageLatest$ = select(
    this.checksLatest$,

    state =>
      Object.values(state).find(
        providerState => providerState.errorMessage !== undefined
      )?.errorMessage
  );

  public errorMessagesLatest$ = select(this.checksLatest$, state => {
    const errorMessages: ErrorMessages = {};
    for (const providerState of Object.values(state)) {
      if (providerState.errorMessage === undefined) continue;
      errorMessages[providerState.pluginName] = providerState.errorMessage;
    }
    return errorMessages;
  });

  public loginCallbackLatest$ = select(
    this.checksLatest$,
    state =>
      Object.values(state).find(
        providerState => providerState.loginCallback !== undefined
      )?.loginCallback
  );

  public topLevelActionsLatest$ = select(this.checksLatest$, state =>
    Object.values(state).reduce(
      (allActions: Action[], providerState: ChecksProviderState) => [
        ...allActions,
        ...providerState.actions,
      ],
      []
    )
  );

  public topLevelActionsSelected$ = select(this.checksSelected$, state =>
    Object.values(state).reduce(
      (allActions: Action[], providerState: ChecksProviderState) => [
        ...allActions,
        ...providerState.actions,
      ],
      []
    )
  );

  public topLevelLinksSelected$ = select(this.checksSelected$, state =>
    Object.values(state).reduce(
      (allLinks: Link[], providerState: ChecksProviderState) => [
        ...allLinks,
        ...providerState.links,
      ],
      []
    )
  );

  public allRunsLatestPatchset$ = select(this.checksLatest$, state =>
    Object.values(state).reduce(
      (allRuns: CheckRun[], providerState: ChecksProviderState) => [
        ...allRuns,
        ...providerState.runs,
      ],
      []
    )
  );

  public allRunsSelectedPatchset$ = select(this.checksSelected$, state =>
    Object.values(state).reduce(
      (allRuns: CheckRun[], providerState: ChecksProviderState) => [
        ...allRuns,
        ...providerState.runs,
      ],
      []
    )
  );

  public allRunsLatestPatchsetLatestAttempt$ = select(
    this.allRunsLatestPatchset$,
    runs => runs.filter(run => run.isLatestAttempt)
  );

  public checkToPluginMap$ = select(this.checksLatest$, state => {
    const map = new Map<string, string>();
    for (const [pluginName, providerState] of Object.entries(state)) {
      for (const run of providerState.runs) {
        map.set(run.checkName, pluginName);
      }
    }
    return map;
  });

  public allResultsSelected$ = select(this.checksSelected$, state =>
    Object.values(state)
      .reduce(
        (allResults: CheckResult[], providerState: ChecksProviderState) => [
          ...allResults,
          ...providerState.runs.reduce(
            (results: CheckResult[], run: CheckRun) =>
              results.concat(run.results ?? []),
            []
          ),
        ],
        []
      )
      .filter(r => r !== undefined)
  );

  constructor(readonly reporting: ReportingService) {
    this.subscriptions = [
      changeNum$.subscribe(x => (this.changeNum = x)),
      this.checkToPluginMap$.subscribe(map => {
        this.checkToPluginMap = map;
      }),
      combineLatest([routerPatchNum$, latestPatchNum$]).subscribe(
        ([routerPs, latestPs]) => {
          this.latestPatchNum = latestPs;
          if (latestPs === undefined) {
            this.setPatchset(undefined);
          } else if (typeof routerPs === 'number') {
            this.setPatchset(routerPs);
          } else {
            this.setPatchset(latestPs);
          }
        }
      ),
    ];
    this.visibilityChangeListener = () => {
      this.documentVisibilityChange$.next(undefined);
    };
    document.addEventListener(
      'visibilitychange',
      this.visibilityChangeListener
    );
    this.reloadListener = () => this.reloadAll();
    document.addEventListener('reload', this.reloadListener);
  }

  finalize() {
    document.removeEventListener('reload', this.reloadListener);
    document.removeEventListener(
      'visibilitychange',
      this.visibilityChangeListener
    );
    for (const s of this.subscriptions) {
      s.unsubscribe();
    }
    this.subscriptions = [];
    this.privateState$.complete();
  }

  // Must only be used by the checks service or whatever is in control of this
  // model.
  updateStateSetProvider(pluginName: string, patchset: ChecksPatchset) {
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    pluginState[pluginName] = {
      pluginName,
      loading: false,
      firstTimeLoad: true,
      runs: [],
      actions: [],
      links: [],
    };
    this.privateState$.next(nextState);
  }

  getPluginState(
    state: ChecksState,
    patchset: ChecksPatchset = ChecksPatchset.LATEST
  ) {
    if (patchset === ChecksPatchset.LATEST) {
      state.pluginStateLatest = {...state.pluginStateLatest};
      return state.pluginStateLatest;
    } else {
      state.pluginStateSelected = {...state.pluginStateSelected};
      return state.pluginStateSelected;
    }
  }

  updateStateSetLoading(pluginName: string, patchset: ChecksPatchset) {
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    pluginState[pluginName] = {
      ...pluginState[pluginName],
      loading: true,
    };
    this.privateState$.next(nextState);
  }

  updateStateSetError(
    pluginName: string,
    errorMessage: string,
    patchset: ChecksPatchset
  ) {
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    pluginState[pluginName] = {
      ...pluginState[pluginName],
      loading: false,
      firstTimeLoad: false,
      errorMessage,
      loginCallback: undefined,
      runs: [],
      actions: [],
    };
    this.privateState$.next(nextState);
  }

  updateStateSetNotLoggedIn(
    pluginName: string,
    loginCallback: () => void,
    patchset: ChecksPatchset
  ) {
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    pluginState[pluginName] = {
      ...pluginState[pluginName],
      loading: false,
      firstTimeLoad: false,
      errorMessage: undefined,
      loginCallback,
      runs: [],
      actions: [],
    };
    this.privateState$.next(nextState);
  }

  updateStateSetResults(
    pluginName: string,
    runs: CheckRunApi[],
    actions: Action[] = [],
    links: Link[] = [],
    patchset: ChecksPatchset
  ) {
    const attemptMap = createAttemptMap(runs);
    for (const attemptInfo of attemptMap.values()) {
      // Per run only one attempt can be undefined, so the '?? -1' is not really
      // relevant for sorting.
      attemptInfo.attempts.sort(
        (a, b) => (a.attempt ?? -1) - (b.attempt ?? -1)
      );
    }
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    pluginState[pluginName] = {
      ...pluginState[pluginName],
      loading: false,
      firstTimeLoad: false,
      errorMessage: undefined,
      loginCallback: undefined,
      runs: runs.map(run => {
        const runId = `${run.checkName}-${run.change}-${run.patchset}-${run.attempt}`;
        const attemptInfo = attemptMap.get(run.checkName);
        assertIsDefined(attemptInfo, 'attemptInfo');
        return {
          ...run,
          pluginName,
          internalRunId: runId,
          isLatestAttempt: attemptInfo.latestAttempt === run.attempt,
          isSingleAttempt: attemptInfo.isSingleAttempt,
          attemptDetails: attemptInfo.attempts,
          results: (run.results ?? []).map((result, i) => {
            return {
              ...result,
              internalResultId: `${runId}-${i}`,
            };
          }),
        };
      }),
      actions: [...actions],
      links: [...links],
    };
    this.privateState$.next(nextState);
  }

  updateStateUpdateResult(
    pluginName: string,
    updatedRun: CheckRunApi,
    updatedResult: CheckResultApi,
    patchset: ChecksPatchset
  ) {
    const nextState = {...this.privateState$.getValue()};
    const pluginState = this.getPluginState(nextState, patchset);
    let runUpdated = false;
    const runs: CheckRun[] = pluginState[pluginName].runs.map(run => {
      if (run.change !== updatedRun.change) return run;
      if (run.patchset !== updatedRun.patchset) return run;
      if (run.attempt !== updatedRun.attempt) return run;
      if (run.checkName !== updatedRun.checkName) return run;
      let resultUpdated = false;
      const results: CheckResult[] = (run.results ?? []).map(result => {
        if (
          result.externalId &&
          result.externalId === updatedResult.externalId
        ) {
          runUpdated = true;
          resultUpdated = true;
          return {
            ...updatedResult,
            internalResultId: result.internalResultId,
          };
        }
        return result;
      });
      return resultUpdated ? {...run, results} : run;
    });
    if (!runUpdated) return;
    pluginState[pluginName] = {
      ...pluginState[pluginName],
      runs,
    };
    this.privateState$.next(nextState);
  }

  updateStateSetPatchset(patchsetNumber?: PatchSetNumber) {
    const nextState = {...this.privateState$.getValue()};
    nextState.patchsetNumberSelected = patchsetNumber;
    this.privateState$.next(nextState);
  }

  setPatchset(num?: PatchSetNumber) {
    this.updateStateSetPatchset(num === this.latestPatchNum ? undefined : num);
  }

  reload(pluginName: string) {
    this.reloadSubjects[pluginName].next();
  }

  reloadAll() {
    for (const key of Object.keys(this.providers)) {
      this.reload(key);
    }
  }

  reloadForCheck(checkName?: string) {
    if (!checkName) return;
    const plugin = this.checkToPluginMap.get(checkName);
    if (plugin) this.reload(plugin);
  }

  updateResult(pluginName: string, run: CheckRunApi, result: CheckResultApi) {
    this.updateStateUpdateResult(
      pluginName,
      run,
      result,
      ChecksPatchset.LATEST
    );
    this.updateStateUpdateResult(
      pluginName,
      run,
      result,
      ChecksPatchset.SELECTED
    );
  }

  triggerAction(action?: Action, run?: CheckRun) {
    if (!action?.callback) return;
    if (!this.changeNum) return;
    const patchSet = run?.patchset ?? this.latestPatchNum;
    if (!patchSet) return;
    const promise = action.callback(
      this.changeNum,
      patchSet,
      run?.attempt,
      run?.externalId,
      run?.checkName,
      action.name
    );
    // If plugins return undefined or not a promise, then show no toast.
    if (!promise?.then) return;

    fireAlert(document, `Triggering action '${action.name}' ...`);
    from(promise)
      // If the action takes longer than 5 seconds, then most likely the
      // user is either not interested or the result not relevant anymore.
      .pipe(takeUntil(timer(5000)))
      .subscribe(result => {
        if (result.errorMessage || result.message) {
          fireAlert(document, `${result.message ?? result.errorMessage}`);
        } else {
          fireEvent(document, 'hide-alert');
        }
        if (result.shouldReload) {
          this.reloadForCheck(run?.checkName);
        }
      });
  }

  register(
    pluginName: string,
    provider: ChecksProvider,
    config: ChecksApiConfig
  ) {
    if (this.providers[pluginName]) {
      console.warn(
        `Plugin '${pluginName}' was trying to register twice as a Checks UI provider. Ignored.`
      );
      return;
    }
    this.providers[pluginName] = provider;
    this.reloadSubjects[pluginName] = new BehaviorSubject<void>(undefined);
    this.updateStateSetProvider(pluginName, ChecksPatchset.LATEST);
    this.updateStateSetProvider(pluginName, ChecksPatchset.SELECTED);
    this.initFetchingOfData(pluginName, config, ChecksPatchset.LATEST);
    this.initFetchingOfData(pluginName, config, ChecksPatchset.SELECTED);
  }

  initFetchingOfData(
    pluginName: string,
    config: ChecksApiConfig,
    patchset: ChecksPatchset
  ) {
    const pollIntervalMs = (config?.fetchPollingIntervalSeconds ?? 60) * 1000;
    // Various events should trigger fetching checks from the provider:
    // 1. Change number and patchset number changes.
    // 2. Specific reload requests.
    // 3. Regular polling starting with an initial fetch right now.
    // 4. A hidden Gerrit tab becoming visible.
    this.subscriptions.push(
      combineLatest([
        changeNum$,
        patchset === ChecksPatchset.LATEST
          ? latestPatchNum$
          : this.checksSelectedPatchsetNumber$,
        this.reloadSubjects[pluginName].pipe(throttleTime(1000)),
        timer(0, pollIntervalMs),
        this.documentVisibilityChange$,
      ])
        .pipe(
          takeWhile(_ => !!this.providers[pluginName]),
          filter(_ => document.visibilityState !== 'hidden'),
          withLatestFrom(change$),
          switchMap(
            ([[changeNum, patchNum], change]): Observable<FetchResponse> => {
              if (!change || !changeNum || !patchNum) return of(this.empty());
              if (typeof patchNum !== 'number') return of(this.empty());
              assertIsDefined(change.revisions, 'change.revisions');
              const patchsetSha = getShaByPatchNum(change.revisions, patchNum);
              // Sometimes patchNum is updated earlier than change, so change
              // revisions don't have patchNum yet
              if (!patchsetSha) return of(this.empty());
              const data: ChangeData = {
                changeNumber: changeNum,
                patchsetNumber: patchNum,
                patchsetSha,
                repo: change.project,
                commitMessage: getCurrentRevision(change)?.commit?.message,
                changeInfo: change as ChangeInfo,
              };
              return this.fetchResults(pluginName, data, patchset);
            }
          ),
          catchError(e => {
            // This should not happen and is really severe, because it means that
            // the Observable has terminated and we won't recover from that. No
            // further attempts to fetch results for this plugin will be made.
            this.reporting.error(e, `checks-model crash for ${pluginName}`);
            return of(this.createErrorResponse(pluginName, e));
          })
        )
        .subscribe(response => {
          switch (response.responseCode) {
            case ResponseCode.ERROR: {
              const message = response.errorMessage ?? '-';
              this.reporting.reportExecution(Execution.CHECKS_API_ERROR, {
                plugin: pluginName,
                message,
              });
              this.updateStateSetError(pluginName, message, patchset);
              break;
            }
            case ResponseCode.NOT_LOGGED_IN: {
              assertIsDefined(response.loginCallback, 'loginCallback');
              this.reporting.reportExecution(
                Execution.CHECKS_API_NOT_LOGGED_IN,
                {
                  plugin: pluginName,
                }
              );
              this.updateStateSetNotLoggedIn(
                pluginName,
                response.loginCallback,
                patchset
              );
              break;
            }
            case ResponseCode.OK: {
              this.updateStateSetResults(
                pluginName,
                response.runs ?? [],
                response.actions ?? [],
                response.links ?? [],
                patchset
              );
              break;
            }
          }
        })
    );
  }

  private empty(): FetchResponse {
    return {
      responseCode: ResponseCode.OK,
      runs: [],
    };
  }

  private createErrorResponse(
    pluginName: string,
    message: object
  ): FetchResponse {
    return {
      responseCode: ResponseCode.ERROR,
      errorMessage:
        `Error message from plugin '${pluginName}':` +
        ` ${JSON.stringify(message)}`,
    };
  }

  private fetchResults(
    pluginName: string,
    data: ChangeData,
    patchset: ChecksPatchset
  ): Observable<FetchResponse> {
    this.updateStateSetLoading(pluginName, patchset);
    const timer = this.reporting.getTimer('ChecksPluginFetch');
    const fetchPromise = this.providers[pluginName]
      .fetch(data)
      .then(response => {
        timer.end({pluginName});
        return response;
      });
    return from(fetchPromise).pipe(
      catchError(e => of(this.createErrorResponse(pluginName, e)))
    );
  }
}
