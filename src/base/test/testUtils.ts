/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '../output/mode';

export const strFrom = (message: Raw.ChatMessage | Raw.ChatCompletionContentPart): string => {
	if ('role' in message) {
		return message.content.map(strFrom).join('');
	} else if (message.type === Raw.ChatCompletionContentPartKind.Text) {
		return message.text;
	} else {
		return '';
	}
}
