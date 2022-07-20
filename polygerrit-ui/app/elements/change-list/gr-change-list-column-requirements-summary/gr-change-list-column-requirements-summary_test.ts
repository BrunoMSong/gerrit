/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import '../../../test/common-test-setup-karma';
import {fixture} from '@open-wc/testing-helpers';
import {html} from 'lit';
import './gr-change-list-column-requirements-summary';
import {GrChangeListColumnRequirementsSummary} from './gr-change-list-column-requirements-summary';
import {
  createApproval,
  createDetailedLabelInfo,
  createParsedChange,
  createSubmitRequirementExpressionInfo,
  createSubmitRequirementResultInfo,
  createNonApplicableSubmitRequirementResultInfo,
} from '../../../test/test-data-generators';
import {
  SubmitRequirementResultInfo,
  SubmitRequirementStatus,
} from '../../../api/rest-api';
import {ParsedChangeInfo} from '../../../types/types';

suite('gr-change-list-column-requirements-summary tests', () => {
  let element: GrChangeListColumnRequirementsSummary;
  let change: ParsedChangeInfo;
  setup(() => {
    const submitRequirement: SubmitRequirementResultInfo = {
      ...createSubmitRequirementResultInfo(),
      status: SubmitRequirementStatus.UNSATISFIED,
      description: 'Test Description',
      submittability_expression_result: createSubmitRequirementExpressionInfo(),
    };
    change = {
      ...createParsedChange(),
      submit_requirements: [
        submitRequirement,
        createNonApplicableSubmitRequirementResultInfo(),
      ],
      labels: {
        Verified: {
          ...createDetailedLabelInfo(),
          all: [
            {
              ...createApproval(),
              value: 2,
            },
          ],
        },
      },
    };
  });

  test('renders', async () => {
    element = await fixture<GrChangeListColumnRequirementsSummary>(
      html`<gr-change-list-column-requirements-summary .change=${change}>
      </gr-change-list-column-requirements-summary>`
    );
    expect(element).shadowDom.to.equal(/* HTML */ ` <span
      class="block"
      role="button"
      tabindex="0"
    >
      <gr-submit-requirement-dashboard-hovercard>
      </gr-submit-requirement-dashboard-hovercard>
      <span class="material-icon block" role="img">block</span>
      <span class="unsatisfied">1 missing</span>
    </span>`);
  });

  test('renders comment count', async () => {
    change = {
      ...change,
      unresolved_comment_count: 5,
    };
    element = await fixture<GrChangeListColumnRequirementsSummary>(
      html`<gr-change-list-column-requirements-summary .change=${change}>
      </gr-change-list-column-requirements-summary>`
    );
    expect(element).shadowDom.to.equal(/* HTML */ ` <span
        class="block"
        role="button"
        tabindex="0"
      >
        <gr-submit-requirement-dashboard-hovercard>
        </gr-submit-requirement-dashboard-hovercard>
        <span class="material-icon block" role="img">block</span>
        <span class="unsatisfied">1 missing</span>
      </span>
      <span
        class="commentIcon material-icon filled"
        title="5 unresolved comments"
        >mode_comment</span
      >`);
  });
});