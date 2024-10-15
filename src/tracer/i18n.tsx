/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Fragment, FunctionComponent, h } from 'preact';

const numberFormat = new Intl.NumberFormat('en-US');

export const Integer: FunctionComponent<{ value: number }> = ({ value }) => (
	<>{numberFormat.format(value)}</>
);
