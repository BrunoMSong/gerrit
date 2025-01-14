/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {css} from 'lit';

export const iconStyles = css`
  iron-icon {
    display: inline-block;
    vertical-align: top;
    width: 20px;
    height: 20px;
  }
  .material-icon {
    color: var(--deemphasized-text-color);
    font-family: var(--icon-font-family, 'Material Symbols Outlined');
    font-weight: normal;
    font-style: normal;
    font-size: 20px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    font-variation-settings: 'FILL' 0;
    vertical-align: top;
  }

  .material-icon.filled {
    font-variation-settings: 'FILL' 1;
  }
`;
