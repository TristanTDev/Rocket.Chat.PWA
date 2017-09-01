import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ChatService } from '../services/chat/chat.service';
import { MessagesQuery, Message } from '../../graphql/types/types';
import { ChannelsService } from '../services/channels/channels.service';
import { Subscription } from 'rxjs/Subscription';
import { Observable } from 'rxjs/Observable';


@Component({
  selector: 'chat-view',
  templateUrl: './chat-view.component.html',
  styleUrls: ['./chat-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ChatViewComponent implements OnInit, OnDestroy {

  @ViewChild('chatContent') chatContent: any;
  @ViewChild('messageInput') messageInput: any;

  private readonly PAGE_MESSAGE_COUNT = 80;
  private readonly PAGE_PERCENT_LOAD_MORE_TRIGGER = 0.3;
  private readonly MAX_PAGE_LOAD_MORE_PIXEL_LEN = 3500;


  public channel: MessagesQuery.Channel;
  private routeParamsSub;
  private messagesSub: Subscription;
  private channelSub: Subscription;
  private chatContentScrollSubscription;
  public isFirstLoad = true;
  public messages;
  public keepIndexOnItemsChange = false;
  public initialLoading = false;
  public directTo: string;
  public isDirect = false;
  public messageForm = new FormGroup({
    message: new FormControl('', Validators.required)
  });

  constructor(private router: Router,
              private route: ActivatedRoute,
              public chatService: ChatService,
              private channelsService: ChannelsService,
              private cd: ChangeDetectorRef) {
  }

  sendMessageButtonFocus(event) {
    this.messageInput.getElementRef().nativeElement.children[0].focus();
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  ngOnInit() {
    this.routeParamsSub = this.route.params.subscribe(params => {
      this.unsubscribeChannel();
      this.isFirstLoad = true;
      this.messages = undefined;

      const url: any = this.route.url;
      this.isDirect = url.value[0].path === 'direct';
      const channelName = params['id'];

      let channelObservable;
      if (this.isDirect) {
        this.directTo = channelName;
        channelObservable = this.channelsService.getDirectChannelByUsername(this.directTo);
      }
      else {
        channelObservable = this.channelsService.getChannelByName(channelName);
      }

      this.channelSub = channelObservable.subscribe((result) => {
        const channelData = result.data;
        const channelLoading = result.loading;
        this.initialLoading = channelLoading && !channelData;
        if (this.initialLoading) {
          this.cd.markForCheck();
          return;
        }
        this.channel = this.isDirect ? channelData.directChannel : channelData.channelByName;
        this.cd.markForCheck();

        const messagesQueryObservable = this.chatService.getMessages({
            channelId: this.channel.id ,
            directTo: this.directTo,
            channelName: null,
            count: this.PAGE_MESSAGE_COUNT ,
            cursor: null ,
            searchRegex: null ,
            excludeServer: false
          }
        );

        this.messagesSub = messagesQueryObservable.subscribe(({data , loading}) => {
          this.initialLoading = loading && !data;
          if (this.initialLoading) {
            this.cd.markForCheck();
            return;
          }

          if (data.messages === null) {
            this.router.navigate(['channel-not-found']);
            return;
          }

          const oldScrollHeight = this.chatContent.nativeElement.scrollHeight;
          this.messages = data.messages.messagesArray.slice().reverse();

          if (this.isFirstLoad) {
            this.isFirstLoad = false;
            this.channel = data.messages.channel;
            this.chatService.subscribeToMessageAdded(this.channel.id, this.directTo);

            setTimeout(() => {
              this.addScrollListener();
              this.scrollToBottom();
            }, 0);
          }

          if (!this.chatService.isLoadingMoreMessages() && this.isScrolledToBottom()) {
            setTimeout(() => {
              this.scrollToBottom();
            }, 0);
          }

          if (this.isScrolledToTop()) {
            setTimeout(() => {
              this.chatContent.nativeElement.scrollTop = this.chatContent.nativeElement.scrollHeight - oldScrollHeight;
            }, 0);
          }

          if (!this.isFirstLoad && this.messages && this.isScrolledToBottom()) {
            this.scrollToBottom();
          }
          this.cd.markForCheck();
        });

        this.scrollToBottom();
        this.cd.markForCheck();
      });
    });
  }

  addScrollListener() {
    const currentPageHeight = this.chatContent.nativeElement.scrollHeight;
    const pagePixelLenForLoadMore = Math.min(currentPageHeight * this.PAGE_PERCENT_LOAD_MORE_TRIGGER , this.MAX_PAGE_LOAD_MORE_PIXEL_LEN);

    if (!this.chatContentScrollSubscription) {
      this.chatContentScrollSubscription = Observable.fromEvent(this.chatContent.nativeElement, 'scroll').subscribe(() => {
        this.onScrollChange(pagePixelLenForLoadMore);
      });
    }
  }

  onScrollChange(pagePixelLenForLoadMore) {
    if (this.chatContent.nativeElement.scrollTop < pagePixelLenForLoadMore) {
      if (!this.chatService.isLoadingMoreMessages()) {
        this.loadMoreMessages();
        this.cd.markForCheck();
      }
    }
  }

  isScrolledToBottom(): boolean {
    const chatElement = this.chatContent.nativeElement;
    return chatElement.scrollTop + chatElement.clientHeight >= chatElement.scrollHeight;
  }

  isScrolledToTop(): boolean {
    return this.chatContent.nativeElement.scrollTop === 0;
  }

  scrollToBottom() {
    this.chatContent.nativeElement.scrollTop = this.chatContent.nativeElement.scrollHeight;
  }

  sendMessage() {
    if (this.messageForm.valid) {
      this.chatService.sendMessage(this.channel.id, this.directTo, this.messageForm.get('message').value);
      this.messageForm.reset();
      this.keepIndexOnItemsChange = false;
      this.scrollToBottom();
    }
  }

  loadMoreMessages() {
    return this.chatService.loadMoreMessages(this.channel.id, this.directTo, this.PAGE_MESSAGE_COUNT);
  }

  trackMessage(index: number, message: Message): string {
    return message ? message.id : undefined;
  }

  unsubscribeChannel() {
    this.chatService.unsubscribeMessagesSubscription();
    if (this.messagesSub) {
      this.messagesSub.unsubscribe();
    }
    if (this.channelSub) {
      this.channelSub.unsubscribe();
    }
  }

  ngOnDestroy() {
    if (this.chatContentScrollSubscription) {
      this.chatContentScrollSubscription.unsubscribe();
    }
    this.unsubscribeChannel();
    if (this.routeParamsSub) {
      this.routeParamsSub.unsubscribe();
    }
  }
}
